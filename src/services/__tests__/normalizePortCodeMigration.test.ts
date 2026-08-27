import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/351_normalize_port_code_and_baplie_alerts.sql'),
  'utf-8',
)

describe('migration 351 — normalização de códigos de porto em SQL e reconciliação Baplie/BL', () => {
  it('define a função SQL normalize_port_code com suporte a aliases incluindo CNTAG', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.normalize_port_code')
    expect(sql).toContain("'CNTAG'")
    expect(sql).toContain("'TAICANG'")
    expect(sql).toContain("'CNTAC'")
    expect(sql).toContain("'NANSHA'")
    expect(sql).toContain("'CNNSA'")
    expect(sql).toContain("'NINGBO'")
    expect(sql).toContain("'CNNGB'")
    expect(sql).toContain("'QINGDAO'")
    expect(sql).toContain("'CNTAO'")
    expect(sql).toContain("'BRVIT'")
    expect(sql).toContain("'BRVIX'")
  })

  it('atualiza reconcile_voyage_baplie_coverage_alerts para filtrar vazios e normalizar rotas', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.reconcile_voyage_baplie_coverage_alerts')
    expect(sql).toContain("COALESCE(status, '') <> 'empty'")
    expect(sql).toContain('public.normalize_port_code(pol)')
    expect(sql).toContain('public.normalize_port_code(pod)')
    expect(sql).toContain("'voyage_baplie_documentary_coverage'")
    expect(sql).toContain('Divergência Baplie/BL')
  })

  it('restringe privilégios de execução', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.normalize_port_code')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.normalize_port_code(TEXT) TO authenticated, service_role')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.reconcile_voyage_baplie_coverage_alerts')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.reconcile_voyage_baplie_coverage_alerts(BIGINT, TEXT) TO authenticated, service_role')
  })
})
