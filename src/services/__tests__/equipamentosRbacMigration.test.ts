import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/211_equipamentos_rbac_hardening.sql'),
  'utf8',
)

describe('migration 211 — RBAC de Equipamentos', () => {
  it('centraliza o bloqueio de Equipamentos no helper ativo e preserva leitura', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.is_active_user()')
    expect(sql).toContain('FUNCTION public.is_active_read_user()')
    expect(sql).toContain('FUNCTION public.is_active_non_equipamentos_user()')
    expect(sql).toContain("role <> 'equipamentos'")
    expect(sql).toContain("cmd IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL')")
    expect(sql).toContain("'is_active_user()', 'is_active_read_user()'")
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

  it('substitui todas as policies permissivas legadas de VAZIOS EXP', () => {
    expect(sql).toContain("tablename = ANY (allowlisted_tables)")
    expect(sql).toContain("CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_active_read_user())")
    expect(sql).toContain("CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_active_user() OR public.is_equipamentos_user())")
    expect(sql).toContain("CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_active_user() OR public.is_equipamentos_user()) WITH CHECK (public.is_active_user() OR public.is_equipamentos_user())")
    expect(sql).toContain("CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_admin())")
  })

  it('preserva policies DELETE existentes fora da allowlist com o gate restrito', () => {
    expect(sql).toMatch(
      /ELSIF p\.cmd = 'DELETE' THEN[\s\S]*?CREATE POLICY %I ON public\.%I%s FOR DELETE TO %s USING \(%s\)[\s\S]*?p\.policyname, p\.tablename, v_as_clause, v_roles, v_write_qual/,
    )
  })

  it('remove a escrita legada autenticada de VAZIOS IMP sem perder SELECT', () => {
    const legacyVaziosImportacao = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/096_rls_initplan_performance_pass.sql'),
      'utf8',
    )

    expect(legacyVaziosImportacao).toContain("ALTER POLICY vazios_imp_containers_update")
    expect(legacyVaziosImportacao).toContain("(SELECT auth.role()) = 'authenticated'")
    expect(sql).toContain("p.permissive = 'PERMISSIVE'")
    expect(sql).toContain("auth.role()=''authenticated''")
    expect(sql).toContain("public.is_active_read_user()")
    expect(sql).toContain("public.is_active_non_equipamentos_user()")
    expect(sql).toContain("p.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')")
  })

  it('so reinterpreta predicates exatos em policies permissivas fora da allowlist', () => {
    expect(sql).toContain("tablename <> ALL (allowed_tables)")
    expect(sql).toContain("p.permissive = 'PERMISSIVE'")
    expect(sql).toContain("regexp_replace(COALESCE(qual, ''), '[[:space:]()]', '', 'g')")
    expect(sql).toContain("v_qual_normalized = 'true'")
    expect(sql).toContain("v_check_normalized = 'true'")
  })

  it('permite apenas imports de Veiculos e VAZIOS EXP para Equipamentos', () => {
    expect(sql).toMatch(/FUNCTION public\.import_vehicle_rows_transactional[\s\S]*?is_equipamentos_user\(\)/)
    expect(sql).toMatch(/FUNCTION public\.import_vazios_bookings_transactional[\s\S]*?is_equipamentos_user\(\)/)

    for (const rpc of [
      'import_vazios_importacao_transactional',
      'replace_vazios_from_baplie_transactional',
      'delete_baplie_manifest_for_voyage',
      'save_granite_bl_review',
    ]) {
      expect(sql).not.toContain(`CREATE OR REPLACE FUNCTION public.${rpc}`)
    }

    expect((sql.match(/REVOKE ALL ON FUNCTION/g) ?? []).length).toBeGreaterThanOrEqual(4)
    expect((sql.match(/GRANT EXECUTE ON FUNCTION/g) ?? []).length).toBeGreaterThanOrEqual(4)
  })

  it('deixa os demais RPCs SECURITY DEFINER cobertos pelo helper ativo central', () => {
    expect(sql).not.toContain('ALTER FUNCTION public.import_bl_freight_transactional')
    expect(sql).toContain("WHERE id = auth.uid() AND active = true AND role <> 'equipamentos'")
  })

  it('registra o estado historico admin-only das tarifas que a migration corretiva precisa substituir', () => {
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
