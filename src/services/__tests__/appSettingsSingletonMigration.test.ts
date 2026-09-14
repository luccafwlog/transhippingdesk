import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(process.cwd(), 'supabase/migrations/044_restore_app_settings_singleton.sql')

describe('migration 044 — reparo do singleton app_settings', () => {
  it('recria a linha padrão sem sobrescrever uma configuração existente', () => {
    expect(existsSync(migrationPath)).toBe(true)
    if (!existsSync(migrationPath)) return

    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toMatch(/INSERT INTO public\.app_settings\s*\(\s*id,\s*communications_enabled,\s*demurrage_dunning_interval_days\s*\)/i)
    expect(sql).toMatch(/VALUES\s*\(\s*1,\s*false,\s*7\s*\)/i)
    expect(sql).toMatch(/ON CONFLICT\s*\(id\)\s*DO NOTHING/i)
  })
})
