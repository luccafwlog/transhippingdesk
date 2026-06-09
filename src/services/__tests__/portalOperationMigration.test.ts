import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readPortalOperationMigration() {
  const dir = resolve(process.cwd(), 'supabase/migrations')
  const file = readdirSync(dir)
    .filter((name) => name.endsWith('_portal_operation_bls.sql'))
    .sort()
    .at(-1)

  expect(file).toBeTruthy()

  const path = resolve(dir, file!)
  expect(existsSync(path)).toBe(true)
  return readFileSync(path, 'utf8')
}

function squash(sql: string) {
  return sql.replace(/\s+/g, ' ')
}

describe('portal operation migration', () => {
  it('defines the portal operation RPC scoped to the authenticated customer', () => {
    const sql = readPortalOperationMigration()
    const compactSql = squash(sql)

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_list_operation_bls\(\)/)
    expect(sql).toMatch(/RETURNS jsonb/i)
    expect(compactSql).toMatch(/LANGUAGE plpgsql STABLE SECURITY DEFINER/)
    expect(sql).toContain("SET search_path TO 'public', 'pg_temp'")
    expect(sql).toContain('v_customer_id bigint := public.current_portal_customer_id();')
    expect(compactSql).toMatch(/b\.customer_id\s*=\s*v_customer_id/)
    expect(sql).toContain('public.bl_containers')
    expect(sql).toContain('public.demurrage_rates')
    expect(compactSql).toMatch(/active\s*=\s*true/)
    expect(compactSql).toMatch(/\(valid_from\s+IS\s+NULL\s+OR\s+valid_from\s*<=\s*CURRENT_DATE\)/)
    expect(compactSql).toMatch(/ORDER BY upper\(trim\(container_type\)\),\s*valid_from DESC NULLS LAST,\s*id DESC/)
  })

  it('returns the expected B/L and container JSON contract', () => {
    const sql = readPortalOperationMigration()
    const compactSql = squash(sql)

    expect(sql).toContain("'bl_id'")
    expect(sql).toContain("'ce_mercante'")
    expect(sql).toContain("'pol'")
    expect(sql).toContain("'pod'")
    expect(sql).toContain("'voyage_id'")
    expect(sql).toContain("'voyage_number'")
    expect(sql).toContain("'vessel_name'")
    expect(sql).toContain("'container_count'")
    expect(sql).toContain("'containers_in_demurrage'")
    expect(sql).toContain("'containers_returned'")
    expect(sql).toContain("'containers'")
    expect(sql).toContain("'id'")
    expect(sql).toContain("'container_number'")
    expect(sql).toContain("'type'")
    expect(sql).toContain("'discharge_date'")
    expect(sql).toContain("'return_date'")
    expect(sql).toContain("'usage_days'")
    expect(sql).toContain("'free_time_days'")
    expect(sql).toContain("'demurrage_days'")
    expect(sql).toContain("'status'")
    expect(compactSql).toMatch(/COALESCE\(c\.return_date,\s*CURRENT_DATE\)\s*-\s*c\.discharge_date/)
    expect(compactSql).toMatch(/GREATEST\([^)]*usage_days\s*-\s*free_time_days[^)]*,\s*0\)/)
    expect(sql).toContain("'sem_descarga'")
    expect(sql).toContain("'devolvido'")
    expect(sql).toContain("'em_demurrage'")
    expect(sql).toContain("'dentro_free_time'")
  })

  it('uses the required free time fallback and grants execution only to portal roles', () => {
    const sql = readPortalOperationMigration()
    const compactSql = squash(sql)

    expect(sql).toContain('bl.free_time_override')
    expect(sql).toContain('ar.free_days')
    expect(sql).toContain("'20RF', '20RQ', '20R1', '40RF', '40RQ', '40R1', '45R1'")
    expect(compactSql).toMatch(/THEN\s+10\s+ELSE\s+21/)
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.portal_list_operation_bls() FROM PUBLIC;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.portal_list_operation_bls() TO authenticated, anon;')
  })
})
