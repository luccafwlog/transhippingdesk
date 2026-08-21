import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (name: string) => readFileSync(resolve(process.cwd(), `supabase/migrations/${name}`), 'utf8')

describe('hardening das correções da integração de alertas', () => {
  it('absorve carriers legados no agregado e revoga a escrita genérica do browser', () => {
    const sql = read('333_alerts_dispute_hardening.sql')
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.upsert_alert_item(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;")
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.resolve_alert_item(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;")
    expect(sql).toContain("WHERE a.type = 'portal_dispute_opened'")
    expect(sql).toContain("'alerts_333_backfill'")
  })

  it('mantém detectores server-only e expõe apenas RPCs tipadas de faturamento', () => {
    const sql = read('333_alerts_dispute_hardening.sql')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.upsert_billing_alert')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.resolve_billing_alert')
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.detect_voyage_operation_alerts() TO service_role;")
    expect(sql).not.toContain("GRANT EXECUTE ON FUNCTION public.detect_voyage_operation_alerts() TO authenticated, service_role;")
  })

  it('protege o turno da conversa, aplica rate limit e atualiza o estado autoritativo', () => {
    const sql = read('334_demurrage_dispute_lifecycle.sql')
    expect(sql).toContain("check_portal_rate_limit('open_dispute', 3, 30)")
    expect(sql).toContain("v_dispute.next_responder <> 'cliente'")
    expect(sql).toContain("state = 'resolvida'")
    expect(sql).toContain("dispute_status = 'resolvido'")
    expect(sql).toContain("INSERT INTO public.portal_notifications")
  })

  it('grava metadados de anexo por RPC validada', () => {
    const sql = read('335_demurrage_dispute_attachments_rpc.sql')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.add_demurrage_dispute_attachment')
    expect(sql).toContain('p_size_bytes > 10485760')
    expect(sql).toContain('demurrage_dispute_attachments(message_id')
  })

  it('recalcula a prontidão do Portal como motivo de Revisão Manual', () => {
    const sql = read('337_review_portal_alert_producer.sql')
    expect(sql).toContain("'review_portal_not_ready'")
    expect(sql).toContain("'Acesso ao portal nao provisionado'")
    expect(sql).toContain('trg_reconcile_bl_review_on_portal_change')
  })
})
