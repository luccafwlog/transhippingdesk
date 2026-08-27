import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migration354 = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/354_reconcile_import_batches_timestamp.sql'),
  'utf8',
)

describe('reconciliação da coluna import_batches.created_at', () => {
  it('mantém a reparação da branch persistente idempotente e protegida contra perda de dados', () => {
    expect(migration354).toContain('FROM information_schema.columns')
    expect(migration354).toContain('IF NOT FOUND THEN')
    expect(migration354).toContain("v_generation_expression = 'uploaded_at'")
    expect(migration354).toContain(
      'import_batches.created_at differs from uploaded_at; refusing to rebuild the compatibility column',
    )
  })
})
