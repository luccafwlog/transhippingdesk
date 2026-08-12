import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('migration 289 — orphan realtime publication', () => {
  it('drops only the unused publication member and is idempotent', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/289_drop_orphan_realtime_publication.sql'), 'utf8')
    expect(sql).toMatch(/IF EXISTS\s*\([\s\S]*pg_publication_tables/)
    expect(sql).toMatch(/ALTER PUBLICATION supabase_realtime DROP TABLE public\.vessel_schedules/)
    const executableSql = sql.replace(/--.*$/gm, '')
    expect(executableSql).not.toMatch(/(^|\n)\s*DROP TABLE|DROP POLICY|REVOKE|GRANT/i)
    expect(sql).toContain('publication itself remain intact')
  })
})
