import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

it('classifies invoices linked to Granite B/Ls and backfills existing links', () => {
  const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations')
  const migration = fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
    .find((sql) => sql.includes('classify_granite_invoice'))

  expect(migration).toBeDefined()
  expect(migration).toMatch(/AFTER\s+INSERT\s+ON\s+public\.invoice_granite_bls/i)
  expect(migration).toMatch(/UPDATE\s+public\.invoices[\s\S]*invoice_type\s*=\s*'granite'/i)
  expect(migration).toMatch(/UPDATE\s+public\.invoices[\s\S]*EXISTS[\s\S]*invoice_granite_bls/i)
})
