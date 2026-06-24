import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/126_preserve_customer_billing_block_reason.sql',
  ),
  'utf8',
)

describe('manifest import billing reason migration', () => {
  it('preserves the billing reason produced by the billing workflow', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.import_manifest_with_postprocess_transactional')
    expect(sql).toContain('PERFORM public.run_billing_for_import_batch')
    expect(sql).not.toContain('bls_without_charges')
    expect(sql).not.toContain('Nenhuma tabela de preco ou tarifa encontrada')
  })
})
