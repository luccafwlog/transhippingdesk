import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migrationPath = resolve(process.cwd(), 'supabase/migrations/354_reconcile_import_batches_timestamp.sql')
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/transhipping_test'
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip

function psql(sql: string) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function applyMigration() {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', databaseUrl, '-f', migrationPath], {
    encoding: 'utf8',
  })
}

describeLocal('migration 354 - reconciliação de import_batches.created_at', () => {
  it('cria a coluna ausente e permanece idempotente na segunda execução', () => {
    try {
      psql('ALTER TABLE public.import_batches DROP COLUMN IF EXISTS created_at;')
      applyMigration()
      applyMigration()

      expect(psql(`
        SELECT is_generated || '|' || generation_expression
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'import_batches'
          AND column_name = 'created_at';
      `)).toBe('ALWAYS|uploaded_at')
    } finally {
      psql('ALTER TABLE public.import_batches DROP COLUMN IF EXISTS created_at;')
      applyMigration()
    }
  })

  it('recusa coluna legada divergente antes de removê-la', () => {
    const marker = `migration-354-${Date.now()}`

    try {
      psql(`
        ALTER TABLE public.import_batches DROP COLUMN IF EXISTS created_at;
        ALTER TABLE public.import_batches ADD COLUMN created_at TIMESTAMPTZ;
        SET session_replication_role = replica;
        INSERT INTO public.import_batches (voyage_id, filename, uploaded_at, created_at)
        VALUES (1, '${marker}', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');
        SET session_replication_role = origin;
      `)

      expect(() => applyMigration()).toThrow()
      expect(psql(`
        SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
        FROM public.import_batches
        WHERE filename = '${marker}';
      `)).toBe('2026-01-02')
    } finally {
      psql(`DELETE FROM public.import_batches WHERE filename = '${marker}';`)
      psql('ALTER TABLE public.import_batches DROP COLUMN IF EXISTS created_at;')
      applyMigration()
    }
  })
})

const migration354 = readFileSync(migrationPath, 'utf8')

describe('reconciliação da coluna import_batches.created_at', () => {
  it('documenta o lock antes da validação e a guarda contra divergência', () => {
    expect(migration354).toContain('LOCK TABLE public.import_batches IN ACCESS EXCLUSIVE MODE;')
    expect(migration354).toContain('FROM information_schema.columns')
    expect(migration354).toContain('IF NOT FOUND THEN')
    expect(migration354).toContain("v_generation_expression = 'uploaded_at'")
    expect(migration354).toContain(
      'import_batches.created_at differs from uploaded_at; refusing to rebuild the compatibility column',
    )
  })
})
