import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/368_portal_gate_criterio_unico_e_recomputo.sql'),
  'utf8',
)

function functionBody(signature: string) {
  const start = sql.indexOf(signature)
  expect(start, `funcao ausente: ${signature}`).toBeGreaterThan(-1)
  const bodyStart = sql.indexOf('$function$', start)
  const bodyEnd = sql.indexOf('$function$;', bodyStart + 10)
  return sql.slice(bodyStart, bodyEnd)
}

describe('migration 368 — criterio unico de portal e recomputo do gate', () => {
  it('cria a funcao unica do criterio com os sinais da ADR 0054', () => {
    const body = functionBody('CREATE OR REPLACE FUNCTION public.customer_portal_access_ready(')
    expect(body).toContain('a.active = true')
    expect(body).toContain("a.account_situation = 'ativo'")
    expect(body).toContain('a.auth_user_id IS NOT NULL')
    expect(body).toContain('NULLIF(btrim(a.recovery_email)')
    expect(body).toContain("COALESCE(a.recovery_email_status, 'ok') = 'ok'")
    expect(body).toContain('FROM public.portal_suppressed_emails s')
  })

  // O achado: com o criterio duplicado, o alerta consolidado resolvia
  // exatamente as contas que a emissao passou a recusar.
  it('os dois consumidores do criterio chamam a funcao unica, sem copia inline', () => {
    const pendencies = functionBody('CREATE OR REPLACE FUNCTION public.compute_bl_review_pendencies(')
    const alerts = functionBody('CREATE OR REPLACE FUNCTION public.reconcile_customer_bl_review_alerts(')
    expect(pendencies).toContain('public.customer_portal_access_ready(p_customer_id)')
    expect(alerts).toContain('public.customer_portal_access_ready(p_customer_id)')
    expect(pendencies).not.toContain('FROM public.customer_portal_accounts')
    expect(alerts).not.toContain('FROM public.customer_portal_accounts')
  })

  it('recomputa review_status com a mesma regra da save_bl_review', () => {
    const body = functionBody('CREATE OR REPLACE FUNCTION public.recompute_bl_review_status(')
    expect(body).toContain('public.compute_bl_review_pendencies(p_bl_id)')
    expect(body).toContain("THEN 'reviewed'")
    expect(body).toContain("ELSE 'pending_review'")
    expect(body).toContain('Pendencias de importacao: ')
    // Nao escreve sem mudanca: evita updated_at novo a cada passagem do trigger.
    expect(body).toContain('IS DISTINCT FROM v_status OR v_bl.notes IS DISTINCT FROM v_notes')
  })

  it('nao devolve B/L ja faturado para a fila de revisao', () => {
    const body = functionBody('CREATE OR REPLACE FUNCTION public.recompute_bl_review_status(')
    expect(body).toContain("IN ('invoiced', 'partially_paid', 'paid')")
  })

  it('o trigger de portal passa a recomputar o gate, nao so o alerta', () => {
    const body = functionBody('CREATE OR REPLACE FUNCTION public.trg_reconcile_bl_review_on_portal_change(')
    expect(body).toContain('public.recompute_bl_review_status(v_bl_id)')
    expect(body).toContain("review_status IN ('pending_review', 'reviewed')")
  })

  // O UPDATE morria no rollback do RAISE da mesma transacao: hold que nunca
  // existiu em disco. So o UPDATE de sucesso (que limpa o hold) permanece.
  it('a fronteira de emissao nao grava mais billing_hold_reason antes de falhar', () => {
    const body = functionBody('CREATE OR REPLACE FUNCTION public.mark_bl_ready_for_billing(')
    const holdWrites = body.match(/UPDATE public\.bls SET billing_hold_reason/g) ?? []
    expect(holdWrites).toHaveLength(0)
    expect(body).toContain("billing_hold_reason = NULL")
    expect(body).toContain('public.compute_bl_review_pendencies(p_bl_id)')
  })

  it('faz o backfill dos B/Ls que passaram pelo criterio frouxo', () => {
    expect(sql).toContain('DO $backfill$')
    expect(sql).toContain('public.recompute_bl_review_status(v_bl_id)')
    expect(sql).toContain("SELECT id, review_status FROM public.bls")
  })

  it('mantem o gate de seguranca das funcoes novas', () => {
    expect(sql).toContain('SET search_path = public, pg_temp')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.customer_portal_access_ready(BIGINT) FROM PUBLIC, anon, authenticated;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.customer_portal_access_ready(BIGINT) TO service_role;')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.recompute_bl_review_status(TEXT) FROM PUBLIC, anon, authenticated;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.recompute_bl_review_status(TEXT) TO service_role;')
  })

  it('nao toca em CE Mercante nem no calculo', () => {
    expect(sql).not.toMatch(/ce_mercante/i)
    expect(sql).not.toMatch(/charge_calculations SET status = 'review_required'/i)
  })
})
