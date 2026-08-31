import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/362_baplie_divergence_review_fixes.sql'),
  'utf-8',
)

describe('migration 362 — correções da revisão de divergência Baplie/BL', () => {
  it('faz o backfill como service_role, sem depender da profundidade de trigger', () => {
    expect(sql).toContain("set_config('request.jwt.claim.role', 'service_role', true)")
    expect(sql).toContain("'foundation_backfill'")
    expect(sql).toContain("v_previous_role TEXT := current_setting('request.jwt.claim.role', true)")
  })

  it('filtra rotas normalizadas nulas e adia a reconciliação durante reimportações', () => {
    expect(sql).toContain('WHERE pol IS NOT NULL AND pod IS NOT NULL')
    expect(sql).toContain("current_setting('alerts.baplie_coverage_deferred', true) = 'on'")
    expect(sql).toContain("set_config('alerts.baplie_coverage_deferred', 'off', true)")
  })

  it('filtra updates por coluna sem perder os transition tables', () => {
    // O PostgreSQL rejeita `UPDATE OF` combinado com transition tables. A
    // função statement-level compara OLD/NEW e evita a reconciliação de datas,
    // demurrage e demais atributos sem efeito na divergência.
    expect(sql).toContain('AFTER UPDATE ON public.baplie_containers')
    expect(sql).toContain('AFTER UPDATE ON public.bls')
    expect(sql).toContain('AFTER UPDATE ON public.bl_containers')
    expect(sql).toContain('REFERENCING OLD TABLE AS old_rows NEW TABLE AS changed_rows')
    expect(sql).toContain('reconcile_baplie_coverage_from_updated_baplie_rows')
    expect(sql).toContain('reconcile_baplie_coverage_from_updated_bls')
    expect(sql).toContain('reconcile_baplie_coverage_from_updated_bl_containers')
  })

  it('redefine as RPCs públicas para reconciliar somente o estado final', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.import_baplie_staging_transactional(')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional(p_bls JSONB, p_changed_by UUID)')
    expect(sql).toContain("'baplie_coverage_import'")
  })
})
