import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(process.cwd(), 'supabase/migrations/042_preview_admin_service_role_grant.sql')

function readMigration() {
  return existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : ''
}

describe('Preview admin service role grant migration', () => {
  it('grants only the profile upsert privileges required by the server-side fixture', () => {
    expect(readMigration()).toMatch(
      /GRANT\s+SELECT,\s*INSERT,\s*UPDATE\s+ON\s+TABLE\s+public\.user_profiles\s+TO\s+service_role;/i,
    )
  })

  it('does not broaden browser access or grant delete to service_role', () => {
    const sql = readMigration()

    expect(sql).not.toMatch(/TO\s+(anon|authenticated)\s*;/i)
    expect(sql).not.toMatch(/GRANT[^;]*DELETE[^;]*user_profiles[^;]*service_role/i)
  })
})
