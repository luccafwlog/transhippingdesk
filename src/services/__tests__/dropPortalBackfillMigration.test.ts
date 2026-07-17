import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(process.cwd(), 'supabase/migrations/203_drop_portal_backfill_rpcs.sql')

describe('migration 201 drop Portal backfill RPCs', () => {
  it('remove exatamente as assinaturas ativas de preflight e backfill', () => {
    const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : ''
    const drops = sql.match(/DROP FUNCTION IF EXISTS[^;]+;/g) ?? []

    expect(drops).toEqual([
      'DROP FUNCTION IF EXISTS public.portal_provisioning_preflight();',
      'DROP FUNCTION IF EXISTS public.portal_provisioning_backfill(TEXT);',
    ])
  })

  it('preserva o reparo interno autorrecuperavel', () => {
    const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : ''
    expect(sql).not.toMatch(/DROP FUNCTION[^;]*portal_repair_missing_accounts/i)
    expect(sql).not.toMatch(/DROP FUNCTION[^;]*portal_list_provisioning_console/i)
  })
})
