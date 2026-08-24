import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = (name: string) => readFileSync(resolve(process.cwd(), 'supabase/migrations', name), 'utf8')

describe('migration 343: hardening de rls em alerts', () => {
  it('revoga dml direto na tabela base alerts e restringe leitura a usuarios ativos', () => {
    const sql = migration('343_alerts_rls_hardening.sql')

    expect(sql).toContain('REVOKE INSERT, UPDATE, DELETE ON public.alerts FROM authenticated, anon, PUBLIC;')
    expect(sql).toContain('GRANT SELECT ON public.alerts TO authenticated;')
    expect(sql).toContain('CREATE POLICY alerts_select_active')
    expect(sql).toContain('USING (public.is_active_user())')
  })
})
