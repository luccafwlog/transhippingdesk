import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = path.resolve('supabase/migrations/304_preserve_breakbulk_ce_mercante.sql')

describe('304_preserve_breakbulk_ce_mercante', () => {
  it('preserva o CE existente quando o payload BB não traz CE', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.import_breakbulk_manifest_transactional/i)
    expect(sql).toMatch(/ce_mercante\s*=\s*CASE[\s\S]+source\.row\s*\?\s*'ce_mercante'[\s\S]+target\.ce_mercante/i)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION[\s\S]+FROM PUBLIC, anon/i)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]+TO authenticated/i)
  })
})
