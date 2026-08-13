import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/290_financial_reads_by_department.sql', 'utf8')

const FINANCIAL_READ_TABLES = [
  'charge_tables',
  'charge_table_items',
  'customer_rate_overrides',
  'charge_calculations',
  'invoices',
  'invoice_items',
  'payments',
  'invoice_bls',
  'bl_receivables',
  'invoice_receivable_links',
  'ledger_settlements',
  'invoice_lifecycle_events',
  'invoice_refunds',
]

const LOCAL_CHARGE_TABLES = ['charge_tables', 'charge_table_items', 'customer_rate_overrides']

describe('290_financial_reads_by_department', () => {
  it('lista exatamente as 13 tabelas restritas por 014/020/066/111', () => {
    const match = sql.match(/financial_read_tables TEXT\[\] := ARRAY\[([\s\S]*?)\];/)
    expect(match).not.toBeNull()
    const listed = [...match![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    expect(listed).toEqual(FINANCIAL_READ_TABLES)
  })

  it('substitui cada _select_admin por _select_read com is_active_read_user()', () => {
    expect(sql).toMatch(/EXECUTE format\('DROP POLICY IF EXISTS %I ON public\.%I', t \|\| '_select_admin', t\)/)
    expect(sql).toMatch(
      /EXECUTE format\(\s*'CREATE POLICY %I ON public\.%I FOR SELECT TO authenticated USING \(public\.is_active_read_user\(\)\)',\s*t \|\| '_select_read', t\s*\)/,
    )
  })

  it('nao usa is_active_user() em SQL executavel da secao de leitura (excluiria equipamentos)', () => {
    const section1 = sql.split('-- Secao 2:')[0]
    const executableLines = section1
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
    expect(executableLines).not.toMatch(/is_active_user\(\)/)
  })

  it('nao toca nenhuma policy de INSERT/UPDATE/DELETE fora de Taxas Locais', () => {
    const section1 = sql.split('-- Secao 2:')[0]
    expect(section1).not.toMatch(/FOR INSERT/)
    expect(section1).not.toMatch(/FOR UPDATE/)
    expect(section1).not.toMatch(/FOR DELETE/)
  })

  it('define can_edit_local_charges espelhando as permissoes charge_tables/charge_overrides de roleHasPermission', () => {
    const body = sql.match(/CREATE OR REPLACE FUNCTION public\.can_edit_local_charges[\s\S]*?\$\$;/)?.[0] ?? ''
    expect(body).toMatch(/role IN \('admin', 'administrativo', 'operator', 'documentacao'\)/)
    expect(body).toMatch(/active = true/)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.can_edit_local_charges\(\) FROM PUBLIC/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.can_edit_local_charges\(\) TO authenticated/)
  })

  it('substitui INSERT/UPDATE/DELETE de charge_tables/charge_table_items/customer_rate_overrides por can_edit_local_charges', () => {
    const match = sql.match(/local_charge_tables TEXT\[\] := ARRAY\[([\s\S]*?)\];/)
    expect(match).not.toBeNull()
    const listed = [...match![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    expect(listed).toEqual(LOCAL_CHARGE_TABLES)

    for (const suffix of ['_insert_admin', '_update_admin', '_delete_admin']) {
      expect(sql).toContain(`t || '${suffix}'`)
    }
    expect(sql).toMatch(/FOR INSERT TO authenticated WITH CHECK \(public\.can_edit_local_charges\(\)\)/)
    expect(sql).toMatch(
      /FOR UPDATE TO authenticated USING \(public\.can_edit_local_charges\(\)\) WITH CHECK \(public\.can_edit_local_charges\(\)\)/,
    )
    expect(sql).toMatch(/FOR DELETE TO authenticated USING \(public\.can_edit_local_charges\(\)\)/)
  })

  it('nao afrouxa invoices/payments/demurrage: nenhuma referencia a can_edit_local_charges fora de Taxas Locais', () => {
    const section2 = sql.split('-- Secao 2')[1]
    for (const table of ['invoices', 'payments', 'demurrage']) {
      expect(section2).not.toMatch(new RegExp(`ON public\\.${table}`))
    }
  })
})
