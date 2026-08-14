import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/299_portal_recovery_email_status.sql', 'utf8')
const assistedSql = readFileSync('supabase/migrations/300_portal_assisted_email_change_invalidates_invites.sql', 'utf8')
const webhook = readFileSync('supabase/functions/portal-email-webhook/index.ts', 'utf8')

describe('Sinal de Email de Recuperação quebrado (299)', () => {
  it('cria coluna própria com os três estados possíveis', () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS recovery_email_status TEXT NOT NULL DEFAULT 'ok'")
    expect(sql).toContain("CHECK (recovery_email_status IN ('ok','bounce_permanente','complaint'))")
  })

  // Achado G: `account_situation` é enum de valor único e `ativo`/`falha_no_envio`
  // são excludentes; marcar falha numa conta ativa afirmaria que ela não está
  // ativa — e está, o cliente continua entrando com a senha.
  it('não toca em account_situation', () => {
    expect(sql).not.toMatch(/account_situation\s*=/)
  })

  it('expõe o sinal e o bloqueio no console de provisionamento', () => {
    expect(sql).toContain("''recovery_email_status'', CASE WHEN v_full_access THEN a.recovery_email_status ELSE NULL END")
    expect(sql).toContain('portal_suppressed_emails s WHERE s.email = lower(a.recovery_email)')
    expect(sql).toContain("REVOKE EXECUTE ON FUNCTION public.portal_list_provisioning_console(BIGINT) FROM PUBLIC, anon;")
  })

  // A reconstrução por pg_get_functiondef preserva o self-heal da 198 e os
  // papéis da 295; se a âncora sumir, a migration precisa falhar alto em vez de
  // aplicar um console sem as chaves novas.
  it('falha alto quando a âncora do console não é encontrada', () => {
    expect(sql).toContain("RAISE EXCEPTION 'Âncora shared_email_count não encontrada")
  })
})

describe('webhook marca o sinal sem rebaixar a conta', () => {
  it('grava recovery_email_status no bounce permanente', () => {
    expect(webhook).toContain("recovery_email_status: status === 'bounce' ? 'bounce_permanente' : 'complaint'")
  })

  it('mantém o rebaixamento restrito a convite_pendente', () => {
    expect(webhook).toContain(".eq('account_situation', 'convite_pendente')")
  })

  // Achado H: o webhook inseria alerta sem checar duplicado.
  it('abre alerta pelo helper deduplicado, não por insert direto', () => {
    expect(webhook).toContain('openAlertOnce(admin, {')
    expect(webhook).not.toMatch(/from\('alerts'\)\.insert/)
  })
})

describe('troca assistida devolve o endereço novo sem histórico (300)', () => {
  it('zera o sinal junto com o email', () => {
    expect(assistedSql).toContain("recovery_email_status='ok'")
  })
})
