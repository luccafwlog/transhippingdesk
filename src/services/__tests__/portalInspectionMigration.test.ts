import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/292_portal_inspection.sql'), 'utf8')

const readRpcNames = [
  'list_invoices', 'invoice_details', 'list_demurrage_invoices',
  'get_demurrage_invoice_detail', 'list_consolidatable_receivables',
  'list_operation_bls', 'get_profile', 'list_notifications', 'notification_unread_count',
]

describe('migration 292 — Inspeção do Portal', () => {
  it('mantém a delegação cliente/inspeção para o mesmo núcleo', () => {
    for (const name of readRpcNames) {
      expect(sql).toMatch(new RegExp(`_portal_${name}_core`))
      expect(sql).toMatch(new RegExp(`portal_inspect_${name}[\\s\\S]*_portal_${name}_core`))
      expect(sql).toMatch(new RegExp(`portal_${name}\\([\\s\\S]*_portal_${name}_core`))
    }
  })

  it('revoga anon nos invólucros, núcleos e guardas sensíveis', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\._portal_inspect_guard\(BIGINT\) FROM PUBLIC, anon/i)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.portal_open_inspection\(BIGINT, TEXT\) FROM PUBLIC, anon/i)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\._portal_[\s\S]*? FROM PUBLIC, anon, authenticated/i)
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.portal_inspect_[^;]+ TO anon/i)
  })

  it('não cria invólucro para operações de escrita e preserva a exceção do overview', () => {
    for (const name of ['create_consolidation', 'obsolete_consolidation', 'open_demurrage_dispute', 'update_profile', 'mark_notification_read', 'mark_all_notifications_read']) {
      expect(sql).not.toMatch(new RegExp(`portal_inspect_${name}`))
    }
    expect(sql).not.toMatch(/portal_inspect_get_session_overview_v2/i)
    expect(sql).not.toMatch(/portal_open_inspection[\s\S]*UPDATE\s+public\.customer_portal_accounts/i)
  })
})
