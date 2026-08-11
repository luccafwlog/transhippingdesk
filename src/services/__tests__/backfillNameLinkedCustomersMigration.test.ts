import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/287_backfill_name_linked_customers.sql'), 'utf8')

describe('backfill de vinculos feitos por nome', () => {
  it('preserva faturados, decisoes humanas e e idempotente', () => {
    expect(sql).toContain("customer_reconciliation_status = 'matched_name'")
    expect(sql).toContain("financial_status, 'pending') NOT IN ('invoiced', 'paid')")
    expect(sql).toContain("suggested_customer_id IS NULL")
    expect(sql).toContain("a.entity_type = 'granite_bl'")
    expect(sql).toContain("a.field_name = 'client_id'")
    expect(sql).toContain('invoice_granite_bls')
    expect(sql).toContain("charge_status, 'not_calculated') NOT IN ('invoiced', 'paid')")
    expect(sql).toContain('invoice_bls')
    expect(sql).toContain('sync_customer_reconciliation_queue_for_bl')
  })

  it('compara documentos normalizados antes de mover granito', () => {
    expect(sql).toContain("regexp_replace(COALESCE(g.shipper_cnpj, ''), '\\D', '', 'g')")
    expect(sql).toContain("regexp_replace(COALESCE(c.cnpj_cpf, ''), '\\D', '', 'g')")
    expect(sql).toContain('IS DISTINCT FROM')
  })
})
