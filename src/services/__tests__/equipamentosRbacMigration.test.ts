import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/211_equipamentos_rbac_hardening.sql'),
  'utf8',
)

describe('migration 211 — RBAC de Equipamentos', () => {
  it('separa leitura ativa da barreira global de escrita', () => {
    expect(sql).toContain('FUNCTION public.is_active_read_user()')
    expect(sql).toContain('FUNCTION public.is_active_non_equipamentos_user()')
    expect(sql).toContain("role <> 'equipamentos'")
    expect(sql).toContain("cmd IN ('INSERT', 'UPDATE', 'ALL')")
    expect(sql).toContain('is_active_non_equipamentos_user')
    expect(sql).toContain('is_active_read_user')
  })

  it('mantem leitura e libera escrita apenas para Veiculos e VAZIOS EXP', () => {
    for (const table of [
      'vehicles',
      'vazios_manifests',
      'vazios_bookings',
      'vazios_export_operations',
      'vazios_export_overtime_depots',
      'vazios_reorg_services',
    ]) {
      expect(sql).toContain(`'${table}'`)
    }

    expect(sql).toContain('public.is_equipamentos_user()')
    expect(sql).toContain('FOR DELETE TO authenticated USING (public.is_admin())')
    const allowlist = sql.match(/allowed_tables TEXT\[\] := ARRAY\[([\s\S]*?)\];/)?.[1] ?? ''
    expect(allowlist).not.toContain('vazios_reorg_rates')
  })

  it('permite apenas imports de Veiculos e VAZIOS EXP para Equipamentos', () => {
    expect(sql).toMatch(/FUNCTION public\.import_vehicle_rows_transactional[\s\S]*?is_active_write_user\(\)/)
    expect(sql).toMatch(/FUNCTION public\.import_vazios_bookings_transactional[\s\S]*?is_active_write_user\(\)/)

    for (const rpc of [
      'import_vazios_importacao_transactional',
      'replace_vazios_from_baplie_transactional',
      'delete_baplie_manifest_for_voyage',
      'save_granite_bl_review',
    ]) {
      const start = sql.indexOf(`FUNCTION public.${rpc}`)
      expect(start).toBeGreaterThanOrEqual(0)
      expect(sql.indexOf('is_active_non_equipamentos_user()', start)).toBeGreaterThan(start)
    }

    expect((sql.match(/REVOKE ALL ON FUNCTION/g) ?? []).length).toBeGreaterThanOrEqual(6)
    expect((sql.match(/GRANT EXECUTE ON FUNCTION/g) ?? []).length).toBeGreaterThanOrEqual(6)
  })

  it('nega a importacao transacional de B/L para Equipamentos no override final', () => {
    const start = sql.indexOf('FUNCTION public.import_bl_freight_transactional')
    expect(start).toBeGreaterThanOrEqual(0)
    expect(sql.indexOf('NOT public.is_active_non_equipamentos_user()', start)).toBeGreaterThan(start)
  })

  it('mantem tarifas de reorganizacao como configuracao exclusiva de admin', () => {
    expect(sql).toContain("WHERE schemaname = 'public' AND tablename = 'vazios_reorg_rates'")
    expect(sql).toContain('CREATE POLICY vazios_reorg_rates_insert_admin')
    expect(sql).toContain('CREATE POLICY vazios_reorg_rates_update_admin')
    expect(sql).toContain('CREATE POLICY vazios_reorg_rates_delete_admin')
    expect(sql).toContain('WITH CHECK (public.is_admin())')
    expect(sql).toContain('FOR DELETE TO authenticated USING (public.is_admin())')
  })

  it('preserva os demais perfis ativos fora das excecoes', () => {
    expect(sql).toContain("role <> 'equipamentos'")
    expect(sql).toContain('active = true')
  })
})
