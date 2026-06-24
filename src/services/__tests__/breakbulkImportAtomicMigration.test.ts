import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

const migrationPath = path.resolve(
  'supabase/migrations/144_import_breakbulk_manifest_transactional.sql',
)

it('persiste o manifesto BB inteiro em uma unica funcao transacional protegida', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8')

  expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.import_breakbulk_manifest_transactional/i)
  expect(sql).toMatch(/public\.import_manifest_transactional/i)
  expect(sql).toMatch(/UPDATE public\.bls/i)
  expect(sql).toMatch(/INSERT INTO public\.bl_breakbulk_items/i)
  expect(sql).toMatch(/apply_bl_review_gate_after_import/i)
  expect(sql).toMatch(/SECURITY INVOKER/i)
  expect(sql).toMatch(/REVOKE ALL ON FUNCTION[\s\S]+FROM PUBLIC, anon/i)
  expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]+TO authenticated/i)
})
