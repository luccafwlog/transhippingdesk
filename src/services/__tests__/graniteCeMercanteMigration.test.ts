import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('granite CE Mercante migration (280)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/280_granite_bls_ce_mercante.sql'),
    'utf8',
  )

  it('adds the nullable CE field and a partial unique index', () => {
    expect(sql).toContain('ALTER TABLE public.granite_bls')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS ce_mercante TEXT;')
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_granite_bls_ce_mercante')
    expect(sql).toContain('ON public.granite_bls (btrim(ce_mercante))')
    expect(sql).toContain('WHERE ce_mercante IS NOT NULL AND btrim(ce_mercante) <>')
  })
})
