import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/230_depot_rbac.sql'), 'utf8')

describe('RBAC de Depot', () => {
  it('aplica leitura autenticada e escrita apenas aos perfis autorizados', () => {
    expect(migration).toContain('public.is_active_read_user()')
    expect(migration).toContain('public.is_admin() OR public.is_equipamentos_user()')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.can_edit_depots()')
  })
})
