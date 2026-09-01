import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/367_portal_gate_criterio_completo.sql'),
  'utf8',
)

const portalCheck = sql.slice(
  sql.indexOf('FROM public.customer_portal_accounts a'),
  sql.indexOf('INTO v_portal_ready'),
)

describe('migration 367 — criterio completo do gate de portal', () => {
  it('redefine o produtor canonico de pendencias, nao uma funcao paralela', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.compute_bl_review_pendencies(')
    expect(sql).toContain('p_customer_id BIGINT, p_cargo_mode TEXT, p_bb_weight_ton NUMERIC')
    expect(sql).toContain('RETURNS TEXT[]')
  })

  it('exige os quatro sinais da ADR 0054 para considerar o portal pronto', () => {
    expect(portalCheck).toContain('a.active = true')
    expect(portalCheck).toContain("a.account_situation = 'ativo'")
    expect(portalCheck).toContain('a.auth_user_id IS NOT NULL')
    expect(portalCheck).toContain('NULLIF(btrim(a.recovery_email)')
    expect(portalCheck).toContain("COALESCE(a.recovery_email_status, 'ok') = 'ok'")
    expect(portalCheck).toContain('FROM public.portal_suppressed_emails s')
  })

  it('preserva as demais pendencias canonicas da 337', () => {
    expect(sql).toContain('Cliente nao vinculado')
    expect(sql).toContain('Cliente sem e-mail cadastrado')
    expect(sql).toContain('Acesso ao portal nao provisionado')
    expect(sql).toContain('Peso BB ausente')
  })

  it('mantem o gate de seguranca da funcao', () => {
    expect(sql).toContain('SECURITY DEFINER SET search_path = public, pg_temp')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.compute_bl_review_pendencies(BIGINT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.compute_bl_review_pendencies(BIGINT, TEXT, NUMERIC) TO service_role')
  })

  it('nao toca em CE Mercante nem no calculo', () => {
    // O gate trava a emissao; calcular taxas para conferencia segue liberado.
    expect(sql).not.toMatch(/ce_mercante/i)
    expect(sql).not.toMatch(/charge_calculations/i)
  })
})
