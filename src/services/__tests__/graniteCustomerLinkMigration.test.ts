import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('separa sugestao e vinculo no Granito sem contaminar o faturamento', () => {
  const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/282_granite_customer_link_requires_document.sql'), 'utf8')
  expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS suggested_client_id BIGINT/i)
  expect(sql).toMatch(/CONSTRAINT granite_bls_suggested_client_id_fkey\s+FOREIGN KEY \(suggested_client_id\)/i)
  expect(sql).toMatch(/import_granite_manifest_transactional_legacy_136/i)
  expect(sql).toMatch(/suggested_client_id/i)
  expect(sql).toMatch(/save_granite_bl_review/i)
  expect(sql).toMatch(/suggested_client_id\s*=\s*NULL/i)
  expect(sql).not.toMatch(/039_granite_invoiceable_view/i)
})
