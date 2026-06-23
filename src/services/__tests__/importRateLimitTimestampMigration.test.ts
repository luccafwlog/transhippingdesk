import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('manifest import rate-limit timestamp compatibility', () => {
  it('provides created_at from the canonical uploaded_at timestamp', () => {
    const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations')
    const sql = fs.readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
      .join('\n')

    expect(sql).toMatch(
      /ALTER TABLE public\.import_batches[\s\S]*ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ[\s\S]*GENERATED ALWAYS AS \(uploaded_at\) STORED/i,
    )
  })
})
