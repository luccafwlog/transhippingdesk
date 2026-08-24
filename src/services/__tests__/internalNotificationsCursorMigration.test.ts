import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(process.cwd(), 'supabase/migrations/340_internal_notifications_cursor.sql')

describe('migration 340 — cursor estável das notificações internas', () => {
  it('substitui offset por cursor composto e preserva a ordenação determinística', () => {
    expect(existsSync(migrationPath)).toBe(true)
    const migration = readFileSync(migrationPath, 'utf8')

    expect(migration).toContain('p_before_created_at TIMESTAMPTZ DEFAULT NULL')
    expect(migration).toContain('p_before_id BIGINT DEFAULT NULL')
    expect(migration).toContain('n.created_at < p_before_created_at')
    expect(migration).toContain('n.created_at = p_before_created_at AND n.id < p_before_id')
    expect(migration).toContain('ORDER BY n.created_at DESC, n.id DESC')
    expect(migration).not.toContain('p_offset')
  })
})
