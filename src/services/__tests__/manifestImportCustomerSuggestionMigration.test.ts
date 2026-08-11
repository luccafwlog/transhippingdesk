import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const migration = () => readFileSync(resolve(process.cwd(), 'supabase/migrations/285_manifest_import_customer_suggestion.sql'), 'utf8')

it('mantem suggested_customer_id no import generico de manifesto', () => {
  const sql = migration()
  expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.import_manifest_transactional/i)
  expect(sql).toMatch(/suggested_customer_id/i)
  expect(sql).toMatch(/p_apply_overwrites/i)
  expect(sql).toMatch(/import_manifest_transactional_legacy_165/i)
  expect(sql).toMatch(/CASE[\s\S]+customer_id[\s\S]+reconciled/i)
  expect(sql).toMatch(/RETURNS bigint/i)
  expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.import_manifest_transactional_legacy_165/i)
})
