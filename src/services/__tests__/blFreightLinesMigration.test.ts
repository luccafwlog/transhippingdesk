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
    expect(sql).toMatch(/bl_emission_date = CASE WHEN EXISTS \([\s\S]+payload \? 'bl_emission_date'[\s\S]+THEN EXCLUDED\.bl_emission_date ELSE bls\.bl_emission_date END/i)
    expect(sql).toMatch(/INSERT INTO public\.bl_freight_lines/i)
  })

  it('preserves omitted correction fields instead of nulling existing data', () => {
    const sql = readMigration()

    expect(sql).toMatch(/shipper = CASE WHEN EXISTS \([\s\S]+payload \? 'shipper'[\s\S]+ELSE bls\.shipper END/i)
    expect(sql).toMatch(/customer_id = bls\.customer_id/i)
    expect(sql).toMatch(/bl_emission_date = CASE WHEN EXISTS \([\s\S]+payload \? 'bl_emission_date'[\s\S]+ELSE bls\.bl_emission_date END/i)
    expect(sql).toMatch(/DELETE FROM public\.bl_freight_lines[\s\S]+payload \? 'freight_lines'[\s\S]+payload \? 'freightLines'/i)
    expect(sql).toMatch(/DELETE FROM public\.vehicles\s+WHERE bl_id = ANY\(v_vehicle_bls\);/i)
    expect(sql).not.toMatch(/DELETE FROM public\.vehicles\s+WHERE bl_id = ANY\(v_container_bls\)/i)
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

  it('gates billing variables (weight for carga solta, containers) behind an operator override', () => {
    const sql = readMigration()

    // weight is only held back for billed carga solta without override
    expect(sql).toMatch(/v_weight_locked_bls[\s\S]+cargo_mode = 'carga_solta'/i)
    expect(sql).toMatch(/total_weight_kg = CASE WHEN EXCLUDED\.id <> ALL\(v_weight_locked_bls\)/i)
    // cbm is never a billing variable -> always applied when present
    expect(sql).toMatch(/total_cbm = CASE WHEN EXISTS \([\s\S]+payload \? 'total_cbm'/i)
    // containers/vehicles apply on billed B/Ls only under override
    expect(sql).toMatch(/INTO v_container_bls[\s\S]+\(NOT billing_locked OR override_billing\)/i)
    expect(sql).toMatch(/INTO v_vehicle_bls[\s\S]+\(NOT billing_locked OR override_billing\)/i)
    // override is audited distinctly from a blocked change
    expect(sql).toMatch(/FATURAMENTO_SOBRESCRITO/i)
    expect(sql).toMatch(/ALTERACAO_OPERACIONAL_BLOQUEADA[\s\S]+billing_impact[\s\S]+NOT t\.override_billing/i)
    // the billed identity (CNPJ/name) is held when the operator declined the override
    expect(sql).toMatch(/v_billing_hold_bls[\s\S]+billing_locked[\s\S]+NOT override_billing/i)
    expect(sql).toMatch(/manifest_customer_cnpj_cpf = CASE WHEN EXCLUDED\.id <> ALL\(v_billing_hold_bls\)/i)
    expect(sql).toMatch(/manifest_customer_name = CASE WHEN EXCLUDED\.id <> ALL\(v_billing_hold_bls\)/i)
  })

  it('reports skipped vehicles that could not be matched to a container', () => {
    const sql = readMigration()

    expect(sql).toMatch(/v_vehicle_items_total/i)
    expect(sql).toMatch(/GET DIAGNOSTICS v_inserted_vehicles = ROW_COUNT/i)
    expect(sql).toMatch(/'vehicles_skipped', v_vehicles_skipped/i)
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
