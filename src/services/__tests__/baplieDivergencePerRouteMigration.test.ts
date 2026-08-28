import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/361_baplie_bl_divergence_per_route.sql'),
  'utf-8',
)

describe('migration 361 — divergência Baplie/B/L por rota', () => {
  it('reconhece Zhoushan (CNZOS) como Ningbo (CNNGB) em normalize_port_code', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.normalize_port_code(p_value TEXT)')
    expect(sql).toMatch(/'ZHOUSHAN', 'CNZOS', 'ZOS'\) THEN 'CNNGB'/)
  })

  it('exige B/L com containers para considerar uma rota coberta', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.reconcile_voyage_baplie_coverage_alerts')
    expect(sql).toMatch(/EXISTS \(\s*SELECT 1 FROM public\.bl_containers bc\s*WHERE bc\.bl_id = b\.id/)
  })

  it('aplica o gate por rota: só silencia a viagem quando NENHUMA rota está coberta', () => {
    expect(sql).toContain('IF v_covered_route_count = 0 AND v_pending_route_count > 0 AND NOT v_is_d7 THEN')
    expect(sql).toContain('baplie_reconcilable')
    // O universo completo do Baplie continua sendo a base do outro sentido da divergência,
    // para que container de rota pendente não vire falso "ausente do Baplie".
    expect(sql).toContain('SELECT container_number FROM bl_cntrs EXCEPT SELECT container_number FROM baplie_all')
  })

  it('recalcula o alerta quando Baplie, B/L ou containers de B/L mudam', () => {
    // Transition tables exigem um evento por trigger: INSERT, UPDATE e DELETE separados.
    for (const base of ['baplie', 'bls', 'bl_containers']) {
      for (const event of ['insert', 'update', 'delete']) {
        expect(sql).toContain(`CREATE TRIGGER reconcile_baplie_coverage_on_${base}_${event}`)
      }
    }
    // Statement-level: uma importação de milhares de linhas reconcilia uma vez por viagem.
    expect(sql).not.toMatch(/FOR EACH ROW EXECUTE FUNCTION public\.reconcile_baplie_coverage/)
    expect((sql.match(/FOR EACH STATEMENT EXECUTE FUNCTION public\.reconcile_baplie_coverage/g) ?? [])).toHaveLength(9)
  })

  it('restaura o hardening da 338 e mantém as trigger functions fora do alcance do cliente', () => {
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.reconcile_voyage_baplie_coverage_alerts(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;',
    )
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.reconcile_voyage_baplie_coverage_alerts(BIGINT, TEXT) TO service_role;',
    )
    expect(sql).not.toContain(
      'GRANT EXECUTE ON FUNCTION public.reconcile_voyage_baplie_coverage_alerts(BIGINT, TEXT) TO authenticated',
    )
    for (const fn of [
      'reconcile_baplie_coverage_from_new_rows',
      'reconcile_baplie_coverage_from_old_rows',
      'reconcile_baplie_coverage_from_new_bl_containers',
      'reconcile_baplie_coverage_from_old_bl_containers',
    ]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn}() FROM PUBLIC, anon, authenticated;`)
      expect(sql).toContain('SET search_path = public, pg_temp')
    }
  })

  it('reconcilia o estado atual das viagens com Baplie sem esperar o próximo evento', () => {
    expect(sql).toContain("'baplie_coverage_backfill'")
  })
})
