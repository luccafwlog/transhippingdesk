import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/327_bloco_522_task5_demurrage_alerts.sql'), 'utf8')
const invoiceModal = readFileSync(resolve(process.cwd(), 'src/components/billing/InvoiceDetailModal.tsx'), 'utf8')

describe('Task 5 do bloco 522 — disputa Demurrage e produtores sem ação', () => {
  it('abre somente a pendência de Equipamentos e resolve quando a próxima ação não é interna', () => {
    expect(migration).toContain('d.next_responder')
    expect(migration).toContain("v_next_responder = 'equipamentos'")
    expect(migration).toContain("'portal_dispute_opened'")
    expect(migration).toContain("'demurrage_invoice'")
    expect(migration).toContain("'/demurrage'")
    expect(migration).toContain("'cliente'")
    expect(migration).toContain("'ninguem'")
    expect(migration).toContain('resolve_alert_item')
    expect(migration).not.toMatch(/demurrage_status[\s\S]*INSERT INTO public\.alerts/i)
    expect(migration).not.toMatch(/invoice_overdue[\s\S]*INSERT INTO public\.alerts/i)
  })

  it('remove produtores Portal sem ação sem apagar audit_logs nem histórico antigo', () => {
    expect(migration).toContain('portal_invoice_created')
    expect(migration).toContain('portal_consolidation_obsoleted')
    expect(migration).toContain('alert_item_events')
    expect(migration).toContain('UPDATE public.alerts')
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.(alerts|alert_items|audit_logs)/i)
    const createBody = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.portal_create_consolidation'))
    const obsoleteBody = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.portal_obsolete_consolidation'))
    expect(createBody).not.toContain('INSERT INTO public.alerts')
    expect(obsoleteBody).not.toContain('INSERT INTO public.alerts')
  })

  it('remove os createAlert dos guards, preservando o registro auditável e o feedback imediato', () => {
    expect(invoiceModal).not.toContain("import { createAlert } from '../../services/alerts'")
    expect(invoiceModal).not.toContain("createAlert({ type: 'invoice_payment_invalid'")
    expect(invoiceModal).not.toContain("createAlert({ type: 'invoice_cancel_blocked'")
    expect(invoiceModal).toContain("logOperationalEvent({ code: 'invoice_payment_invalid'")
    expect(invoiceModal).toContain("logOperationalEvent({ code: 'invoice_cancel_blocked'")
    expect(invoiceModal).toContain("showToast(msg, 'error')")
  })
})
