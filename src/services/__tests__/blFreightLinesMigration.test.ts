import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readMigration = () =>
  readFileSync(resolve(process.cwd(), 'supabase/migrations/162_bl_freight_lines.sql'), 'utf8')

describe('BL freight lines migration contract', () => {
  it('creates freight-line storage with BL-coherent RLS and indexes', () => {
    const sql = readMigration()

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.bl_freight_lines/i)
    expect(sql).toMatch(/bl_id TEXT NOT NULL REFERENCES public\.bls\(id\) ON DELETE CASCADE/i)
    expect(sql).toMatch(/UNIQUE \(bl_id, seq\)/i)
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_bl_freight_lines_bl_id/i)
    expect(sql).toMatch(/ALTER TABLE public\.bl_freight_lines ENABLE ROW LEVEL SECURITY/i)
    expect(sql).toMatch(/CREATE POLICY bl_freight_lines_select_active/i)
    expect(sql).toMatch(/CREATE POLICY bl_freight_lines_insert_active/i)
    expect(sql).toMatch(/CREATE POLICY bl_freight_lines_update_active/i)
    expect(sql).toMatch(/CREATE POLICY bl_freight_lines_delete_admin/i)
  })

  it('adds BL emission date and persists it through the import RPC', () => {
    const sql = readMigration()

    expect(sql).toMatch(/ALTER TABLE public\.bls[\s\S]+ADD COLUMN IF NOT EXISTS bl_emission_date DATE/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.import_bl_freight_transactional/i)
    expect(sql).toMatch(/bl_emission_date = EXCLUDED\.bl_emission_date/i)
    expect(sql).toMatch(/INSERT INTO public\.bl_freight_lines/i)
  })

  it('guards protected operational mutations when billing artifacts exist', () => {
    const sql = readMigration()

    expect(sql).toMatch(/EXISTS \([\s\S]+FROM public\.charge_calculations/i)
    expect(sql).toMatch(/EXISTS \([\s\S]+FROM public\.invoice_bls/i)
    expect(sql).toMatch(/ALTERACAO_OPERACIONAL_BLOQUEADA/i)
    expect(sql).toMatch(/billing_locked/i)
    expect(sql).toMatch(/DELETE FROM public\.bl_containers/i)
    expect(sql).toMatch(/INSERT INTO public\.vehicles/i)
  })

  it('audits overwritten BL fields and keeps billing out of the RPC', () => {
    const sql = readMigration()
    const body = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional'))

    expect(body).toMatch(/INSERT INTO public\.audit_logs/i)
    expect(body).toMatch(/Importacao automatica de frete do BL/i)
    expect(body).not.toMatch(/run_billing|calculate_bl_local_charges|INSERT INTO public\.charge_calculations|INSERT INTO public\.invoice_bls/i)
  })

  it('uses fixed search_path, active-user auth, and authenticated-only execute', () => {
    const sql = readMigration()

    expect(sql).toMatch(/SECURITY DEFINER/i)
    expect(sql).toMatch(/SET search_path = public, pg_temp/i)
    expect(sql).toMatch(/auth\.uid\(\) IS NULL[\s\S]+NOT public\.is_active_user\(\)[\s\S]+p_changed_by IS DISTINCT FROM auth\.uid\(\)/i)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.import_bl_freight_transactional\(JSONB, UUID\) FROM PUBLIC, anon;/i)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.import_bl_freight_transactional\(JSONB, UUID\) TO authenticated;/i)
  })
})
