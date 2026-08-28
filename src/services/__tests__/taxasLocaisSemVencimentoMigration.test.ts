import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/348_taxas_locais_sem_vencimento.sql'),
  'utf8',
)

describe('migration 348 - retirada de vencimento das taxas locais', () => {
  it('ignora assinaturas antigas que já não existem no schema', () => {
    expect(migration).toContain('v_proc := to_regprocedure(p_signature)')
    expect(migration).toContain('IF v_proc IS NULL THEN')
    expect(migration).toContain('RETURN')
    expect(migration).toContain("replace(pg_get_functiondef(v_proc), chr(13), '')")
  })
})
