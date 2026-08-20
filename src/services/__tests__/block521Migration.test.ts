import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/324_clientes_portal_disputes_alerts.sql', 'utf8')

describe('324 — Clientes, Portal e Disputes do bloco 521', () => {
  it('remove o estado de provisionamento obsoleto e reconcilia pendências no agregado', () => {
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS customer_portal_accounts_provisioning_decision_check/i)
    expect(sql).toMatch(/provisioning_decision IN \('aguardando_analise', 'aprovado_para_provisionar'\)/i)
    expect(sql).toContain('public.reconcile_client_portal_alerts')
    expect(sql).toContain('public.block521_upsert_alert')
    expect(sql).toContain('upsert_alert_item(text,text,text,text,text,text,jsonb,text)')
    expect(sql).toMatch(/public\.block521_upsert_alert\(\s*'portal_pendencia_geral'/i)
    expect(sql).toMatch(/public\.block521_resolve_alert\(\s*'portal_pendencia_geral'/i)
  })

  it('protege o gate final, a exceção de invoice e o reprocessamento pós-ativação', () => {
    expect(sql).toContain('public.portal_billing_gate')
    expect(sql).toMatch(/CREATE TRIGGER trg_portal_invoice_exception_open[\s\S]*AFTER INSERT OR UPDATE OF status/i)
    expect(sql).toContain('public.reprocess_customer_billing_after_portal_activation')
    expect(sql).toContain("customer_reconciliation_status IN ('matched_document', 'reconciled')")
  })

  it('modela Dispute como conversa auditável com anexos por mensagem', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.demurrage_disputes')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.demurrage_dispute_messages')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.demurrage_dispute_attachments')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.portal_add_dispute_message')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.reopen_demurrage_dispute')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.list_demurrage_disputes_internal')
    expect(sql).toMatch(/v_role <> 'equipamentos'.*reabrir/s)
    expect(sql).toMatch(/storage\.objects[\s\S]*demurrage-disputes/i)
  })
})
