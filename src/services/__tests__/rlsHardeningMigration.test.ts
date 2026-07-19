import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('remaining permissive RLS hardening migration', () => {
  it('replaces permissive policies on BAPLIE and voyage export tables', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/091_harden_remaining_permissive_rls.sql'),
      'utf8',
    )

    expect(sql).toContain('baplie_reconciliation_resolutions')
    expect(sql).toContain('baplie_containers')
    expect(sql).toContain('voyage_export_schedules')
    expect(sql).toContain('DROP POLICY IF EXISTS')
    expect(sql).toContain('public.is_active_user()')
    expect(sql).toContain('public.is_admin()')
  })

  it('replaces every allowlisted Equipamentos policy before recreating it', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/211_equipamentos_rbac_hardening.sql'),
      'utf8',
    )
    const legacyVehiclesSql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/004_vehicles.sql'),
      'utf8',
    )
    const allowlistStart = sql.indexOf('allowlisted_tables TEXT[]')
    const dropAllPolicies = sql.indexOf('DROP POLICY %I ON public.%I', allowlistStart)
    const firstCreate = sql.indexOf('CREATE POLICY %I ON public.%I', allowlistStart)

    for (const legacyPolicy of [
      'vehicles_select_authenticated',
      'vehicles_insert_authenticated',
      'vehicles_update_authenticated',
      'vehicles_delete_authenticated',
    ]) {
      expect(legacyVehiclesSql).toContain(`CREATE POLICY ${legacyPolicy}`)
    }

    for (const table of [
      'vehicles',
      'vazios_manifests',
      'vazios_bookings',
      'vazios_export_operations',
      'vazios_export_overtime_depots',
      'vazios_reorg_services',
    ]) {
      expect(sql.slice(allowlistStart, dropAllPolicies)).toContain(`'${table}'`)
    }

    expect(sql.slice(allowlistStart, dropAllPolicies)).toContain('tablename = ANY (allowlisted_tables)')
    expect(dropAllPolicies).toBeGreaterThan(allowlistStart)
    expect(firstCreate).toBeGreaterThan(dropAllPolicies)

    for (const policySuffix of [
      'select_active',
      'insert_active',
      'update_active',
      'delete_admin',
      'select',
      'insert_equipamentos',
      'update_equipamentos',
      'delete_admin',
    ]) {
      expect(sql).toContain(`t || '_${policySuffix}'`)
    }
  })
})
