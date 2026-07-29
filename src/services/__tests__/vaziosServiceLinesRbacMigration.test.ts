import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('migration 241 — escrita de linhas de Vazios EXP', () => {
  it('alinha a RLS ao papel operacional de Vazios', () => {
    const sql = readFileSync(resolve(__dirname, '../../../supabase/migrations/241_vazios_export_service_lines_rbac.sql'), 'utf8')
    expect(sql).toContain('DROP POLICY IF EXISTS vazios_export_service_lines_write')
    expect(sql).toContain('public.is_active_user() OR public.is_equipamentos_user()')
  })
})
