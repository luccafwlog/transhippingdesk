import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readGateMigration() {
  const dir = resolve(process.cwd(), 'supabase/migrations')
  const file = readdirSync(dir)
    .filter((name) => name.endsWith('_portal_ce_mercante_gate.sql'))
    .sort()
    .at(-1)

  expect(file).toBeTruthy()

  const path = resolve(dir, file!)
  expect(existsSync(path)).toBe(true)
  return readFileSync(path, 'utf8')
}

function squash(sql: string) {
  return sql.replace(/\s+/g, ' ')
}

describe('portal CE Mercante gate migration', () => {
  const sql = readGateMigration()
  const compactSql = squash(sql)

  it('defines a central BL portal release helper based on non-empty CE Mercante', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.bl_has_portal_release\(p_bl_id TEXT\)/)
    expect(compactSql).toMatch(/RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER/)
    expect(sql).toContain("SET search_path TO 'public', 'pg_temp'")
    expect(compactSql).toMatch(/trim\(coalesce\(b\.ce_mercante,\s*''\)\)\s*<>\s*''/)
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bl_has_portal_release(TEXT) FROM PUBLIC;')
  })

  it('filters operational BLs and portal receivables through the helper', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_list_operation_bls\(\)/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_list_consolidatable_receivables\(\)/)
    expect(compactSql).toMatch(/WHERE b\.customer_id = v_customer_id AND public\.bl_has_portal_release\(b\.id\)/)
    expect(compactSql).toMatch(/WHERE br\.customer_id = v_customer_id AND br\.source = 'local_charges' AND public\.bl_has_portal_release\(br\.bl_id\)/)
  })

  it('guards portal consolidation creation against receivables without CE Mercante', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_create_consolidation\(p_receivable_ids BIGINT\[\]\)/)
    expect(sql).toContain("public.check_portal_rate_limit('create_consolidation', 3, 10)")
    expect(sql).toContain("RAISE EXCEPTION 'Selecao contem B/L sem CE Mercante liberado para o portal.'")
    expect(compactSql).toMatch(/FROM public\.bl_receivables AS br WHERE br\.id = ANY\(v_ids\) AND NOT public\.bl_has_portal_release\(br\.bl_id\)/)
  })

  it('requires all linked BLs to be released before listing or detailing local invoices', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_list_invoices\(\)/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_invoice_details\(p_invoice_id bigint\)/)
    expect(sql).toContain('linked_invoice_bls AS')
    expect(sql).toContain('eligible_invoices AS')
    expect(compactSql).toMatch(/SELECT ib\.invoice_id, ib\.bl_id FROM public\.invoice_bls AS ib UNION SELECT irl\.invoice_id, irl\.bl_id FROM public\.invoice_receivable_links AS irl WHERE irl\.status = 'active'/)
    expect(compactSql).toMatch(/EXISTS \( SELECT 1 FROM linked_invoice_bls AS linked WHERE linked\.invoice_id = i\.id \)/)
    expect(compactSql).toMatch(/NOT EXISTS \( SELECT 1 FROM linked_invoice_bls AS linked WHERE linked\.invoice_id = i\.id AND NOT public\.bl_has_portal_release\(linked\.bl_id\) \)/)
    expect(compactSql).toMatch(/JOIN eligible_invoices AS eligible ON eligible\.invoice_id = i\.id/)
  })

  it('gates portal demurrage list and detail by the BL CE Mercante', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_list_demurrage_invoices\(\)/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_get_demurrage_invoice_detail\(p_invoice_id bigint\)/)
    expect(compactSql).toMatch(/WHERE di\.customer_id = v_customer_id AND di\.status IN \('issued', 'overdue', 'paid'\) AND public\.bl_has_portal_release\(di\.bl_id\)/)
  })
})
