import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// ADR 0040: a vigência da Tabela de Taxas Locais deixa de decidir o cálculo, e
// a ETA deixa de ser pré-requisito para calcular.
describe('charge table validity is informational migration (274)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/274_charge_table_validity_is_informational.sql'),
    'utf8',
  )

  const resolver = sql.slice(
    sql.indexOf('CREATE OR REPLACE FUNCTION public.resolve_local_charge_table_id'),
    sql.indexOf('CREATE OR REPLACE FUNCTION public.calculate_bl_local_charges'),
  )

  it('resolves the charge table by scope and active only, never by vigência', () => {
    expect(resolver).toContain('ct.active = true')
    expect(resolver).toContain('ct.cargo_mode = p_cargo_mode')
    expect(resolver).not.toContain('ct.valid_from <= p_reference_date')
    expect(resolver).not.toContain('ct.valid_to IS NULL OR ct.valid_to >= p_reference_date')
  })

  it('keeps a deterministic tie-break between active tables of the same scope', () => {
    expect(resolver).toContain('ORDER BY ct.valid_from DESC, ct.id DESC')
    expect(resolver).toContain('LIMIT 1')
  })

  it('keeps the resolver signature and its pinned search_path', () => {
    expect(resolver).toContain('p_reference_date DATE DEFAULT NULL')
    expect(resolver).toContain('SET search_path = public, pg_temp')
  })

  it('stops flagging review:no_eta and stops gating the calculation on a reference date', () => {
    const body = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.calculate_bl_local_charges'))
    expect(body).not.toContain("'review:no_eta', 1, 0")
    expect(body).not.toContain('IF v_ref_date IS NOT NULL THEN')
    expect(body).toContain('v_ref_date := COALESCE(v_ref_date, CURRENT_DATE);')
  })

  it('still resolves the customer rate override by its own vigência, using the reference date', () => {
    expect(sql).toContain('AND (cro.valid_from IS NULL OR cro.valid_from <= v_ref_date)')
    expect(sql).toContain('AND (cro.valid_to IS NULL OR cro.valid_to >= v_ref_date)')
  })

  it('keeps the ISO guard on the snapshot eta so malformed audit text never raises', () => {
    expect(sql).toContain("v_eta_raw.eta_text ~ '^\\d{4}-\\d{2}-\\d{2}$'")
  })

  it('keeps the guards the earlier migrations installed', () => {
    expect(sql).toContain("IF v_bl.financial_status IN ('invoiced', 'partially_paid', 'paid') THEN")
    expect(sql).toContain('v_is_lcl_movement')
    expect(sql).toContain("'review:no_table'")
    expect(sql).toContain("'review:no_containers'")
    expect(sql).toContain('v_container_shares')
  })

  it('clears the stale review:no_eta rows only for B/Ls that are not invoiced yet', () => {
    const cleanup = sql.slice(sql.indexOf('DELETE FROM public.charge_calculations AS cc'))
    expect(cleanup).toContain("cc.calculation_key = 'review:no_eta'")
    expect(cleanup).toContain("NOT IN ('invoiced', 'partially_paid', 'paid')")
  })
})
