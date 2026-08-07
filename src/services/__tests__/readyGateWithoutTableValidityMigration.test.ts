import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// ADR 0040, correção da review da PR 506: o gate de ready_for_billing exigia
// tabela vigente em CURRENT_DATE mesmo depois de a migration 274 tirar a
// vigência do cálculo — a trava tinha mudado de lugar, não sumido.
describe('ready gate without table validity migration (275)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/275_ready_gate_without_table_validity.sql'),
    'utf8',
  )

  it('redefines mark_bl_ready_for_billing', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.mark_bl_ready_for_billing\b/)
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.mark_bl_ready_for_billing(TEXT, UUID) TO authenticated;')
    expect(sql).toContain('SET search_path = public, pg_temp')
  })

  it('gates the charge table by scope and active, with no date filter', () => {
    const gate = sql.slice(sql.indexOf('INTO v_table_count'), sql.indexOf('IF v_table_count = 0 THEN'))
    expect(gate).toContain('public.normalize_port_code(pod) = public.normalize_port_code(v_bl.pod)')
    expect(gate).toContain('AND cargo_mode = v_bl.cargo_mode')
    expect(gate).toContain('AND active = true;')
    expect(gate).not.toContain('CURRENT_DATE')
  })

  it('keeps every other gate the earlier migrations installed', () => {
    expect(sql).toContain('B/L % nao possui cliente vinculado')
    expect(sql).toContain('compute_bl_review_pendencies')
    expect(sql).toContain('Ainda existem linhas com pendencia de revisao')
    expect(sql).toContain('B/L sem linhas faturaveis.')
    expect(sql).toContain('PERFORM public.sync_local_charge_receivable(p_bl_id);')
    expect(sql).toContain('INSERT INTO public.audit_logs')
  })
})
