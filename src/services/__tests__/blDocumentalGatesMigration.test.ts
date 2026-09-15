import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(process.cwd(), 'supabase/migrations/047_bl_documental_gates.sql')

function readMigration() {
  expect(existsSync(migrationPath)).toBe(true)
  return readFileSync(migrationPath, 'utf8')
}

function compact(sql: string) {
  return sql.replace(/\s+/g, ' ')
}

describe('B/L Documental billing gates migration', () => {
  it('adds a private CE Mercante assertion with a hardened search path', () => {
    const sql = readMigration()
    const normalized = compact(sql)

    expect(normalized).toMatch(
      /CREATE OR REPLACE FUNCTION public\.assert_bl_ce_mercante\(p_bl_id text\).*RETURNS void LANGUAGE plpgsql SECURITY DEFINER/,
    )
    expect(sql).toContain("SET search_path TO 'public', 'pg_temp'")
    expect(normalized).toMatch(/NULLIF\(BTRIM\(ce_mercante\), ''\) IS NOT NULL/)
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.assert_bl_ce_mercante(text) FROM PUBLIC, anon, authenticated;')
  })

  it('makes CE Mercante a prerequisite of marking a B/L ready for billing', () => {
    const normalized = compact(readMigration())

    expect(normalized).toMatch(/CREATE OR REPLACE FUNCTION public\.mark_bl_ready_for_billing\(p_bl_id text, p_actor uuid DEFAULT NULL::uuid\)/)
    expect(normalized).toMatch(/mark_bl_ready_for_billing[\s\S]*?assert_bl_ce_mercante\(p_bl_id\)/)
    expect(normalized).toMatch(/REVOKE ALL ON FUNCTION public\.mark_bl_ready_for_billing\(p_bl_id text, p_actor uuid\) FROM PUBLIC/)
    expect(normalized).toMatch(/GRANT EXECUTE ON FUNCTION public\.mark_bl_ready_for_billing\(p_bl_id text, p_actor uuid\) TO authenticated/)
  })

  it('guards individual and consolidated invoice links at the issued boundary', () => {
    const normalized = compact(readMigration())

    expect(normalized).toMatch(/CREATE OR REPLACE FUNCTION public\.enforce_invoice_ce_gate\(\).*RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER/)
    expect(normalized).toMatch(/CREATE TRIGGER trg_enforce_invoice_ce_gate BEFORE INSERT OR UPDATE OF invoice_id, bl_id ON public\.invoice_bls/)
    expect(normalized).toMatch(/CREATE OR REPLACE FUNCTION public\.enforce_receivable_invoice_ce_gate\(\).*RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER/)
    expect(normalized).toMatch(/CREATE TRIGGER trg_enforce_receivable_invoice_ce_gate BEFORE INSERT OR UPDATE OF invoice_id, bl_id, status ON public\.invoice_receivable_links/)
    expect(normalized).toMatch(/invoice_receivable_links[\s\S]*?assert_bl_ce_mercante\(NEW\.bl_id\)/)
  })

  it('guards issuing an invoice after its links already exist and closes the direct bl_id bypass', () => {
    const normalized = compact(readMigration())

    expect(normalized).toMatch(/CREATE OR REPLACE FUNCTION public\.enforce_invoice_ce_on_issue\(\).*RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER/)
    expect(normalized).toMatch(/CREATE TRIGGER trg_enforce_invoice_ce_on_issue BEFORE INSERT OR UPDATE OF status, bl_id ON public\.invoices/)
    expect(normalized).toMatch(/FROM public\.invoice_bls AS ib WHERE ib\.invoice_id = NEW\.id/)
    expect(normalized).toMatch(/FROM public\.invoice_receivable_links AS irl WHERE irl\.invoice_id = NEW\.id AND irl\.status = 'active'/)
    expect(normalized).toContain('ELSIF OLD.bl_id IS DISTINCT FROM NEW.bl_id THEN')
    expect(normalized).toContain('PERFORM public.assert_bl_ce_mercante(NEW.bl_id);')
    expect(normalized).toContain('IF v_scan_links THEN')
    expect(normalized).toContain('REVOKE ALL ON FUNCTION public.enforce_invoice_ce_on_issue() FROM PUBLIC, anon, authenticated')
  })

  it('does not introduce due-date or overdue semantics', () => {
    expect(readMigration()).not.toMatch(/vencimento|vencida|overdue/i)
  })

  it('projects the canonical Portal readiness through the existing scoped B/L RPC', () => {
    const normalized = compact(readMigration())

    expect(normalized).toMatch(/CREATE OR REPLACE FUNCTION public\.get_bl_portal_status\(p_bl_id text\).*SECURITY DEFINER/)
    expect(normalized).toMatch(/get_bl_portal_status[\s\S]*?public\.customer_portal_access_ready\(v_customer_id\)/)
    expect(normalized).toMatch(/get_bl_portal_status[\s\S]*?'portal_access_ready'/)
    expect(normalized).toContain("SET search_path TO 'public', 'pg_temp'")
    expect(normalized).toContain('REVOKE ALL ON FUNCTION public.get_bl_portal_status(p_bl_id text) FROM PUBLIC, anon;')
    expect(normalized).toContain('GRANT EXECUTE ON FUNCTION public.get_bl_portal_status(p_bl_id text) TO authenticated;')
    expect(normalized).not.toContain('GRANT EXECUTE ON FUNCTION public.customer_portal_access_ready')
  })
})
