import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/326_voyage_operation_alerts.sql'),
  'utf-8',
)

describe('migration 326 — detectores e reconciliação de alertas de operação e viagem', () => {
  it('define funções helper para resolução de PODs elegíveis e 1º ETA brasileiro', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_voyage_eligible_pods')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_voyage_first_brazilian_eta')
    expect(sql).toContain("entity_type = 'voyage_pod_schedule'")
    expect(sql).toContain("indicated_first_brazilian_eta")
    expect(sql).toContain("indicated_first_brazilian_port")
  })

  it('define os reconciliadores de nível viagem (BL, Baplie e CE Mercante)', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.reconcile_voyage_bl_expected_alerts')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.reconcile_voyage_baplie_missing_alerts')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.reconcile_voyage_baplie_coverage_alerts')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.reconcile_voyage_ce_mercante_missing_alerts')

    expect(sql).toContain("'voyage_bl_expected'")
    expect(sql).toContain("'voyage_baplie_missing'")
    expect(sql).toContain("'voyage_baplie_documentary_coverage'")
    expect(sql).toContain("'voyage_ce_mercante_missing'")

    expect(sql).toContain("regexp_replace(upper(btrim(container_number)), '\\s+', '', 'g')")
    expect(sql).toContain("v_today < (v_first_eta - 7)")
    expect(sql).toContain("v_today < (v_first_eta - 5)")
  })

  it('define os reconciliadores de datas da escala e exportação pós-ATD', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.reconcile_voyage_schedule_date_alerts')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.reconcile_voyage_export_after_atd_alerts')

    expect(sql).toContain("'voyage_schedule_date_pending'")
    expect(sql).toContain("'voyage_terminal_date_pending'")
    expect(sql).toContain("'voyage_export_after_atd'")

    expect(sql).toContain("'voyage_pod_schedule'")
    expect(sql).toContain("'voyage_escala_terminal'")
  })

  it('define reconciliador geral da viagem e detector geral de operações', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.reconcile_voyage_operation_alerts')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.detect_voyage_operation_alerts')
    expect(sql).toContain("status = 'active'")
  })

  it('integra detect_voyage_operation_alerts no executor server-only run_alert_detectors', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.run_alert_detectors()')
    expect(sql).toContain('v_voyage_ops := public.detect_voyage_operation_alerts();')
    expect(sql).toContain("'voyage_operation_alerts', v_voyage_ops")
  })

  it('restringe privilégios com SECURITY DEFINER e REVOKE de public/anon', () => {
    const functions = [
      'get_voyage_eligible_pods',
      'get_voyage_first_brazilian_eta',
      'reconcile_voyage_bl_expected_alerts',
      'reconcile_voyage_baplie_missing_alerts',
      'reconcile_voyage_baplie_coverage_alerts',
      'reconcile_voyage_ce_mercante_missing_alerts',
      'reconcile_voyage_schedule_date_alerts',
      'reconcile_voyage_export_after_atd_alerts',
      'reconcile_voyage_operation_alerts',
      'detect_voyage_operation_alerts',
      'run_alert_detectors',
    ]

    for (const fn of functions) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn}`)
    }
  })
})
