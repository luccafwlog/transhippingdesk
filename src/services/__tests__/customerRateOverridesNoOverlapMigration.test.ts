import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('customer rate overrides no overlap migration (267)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/267_customer_rate_overrides_no_overlap.sql'),
    'utf8',
  )

  it('pre-checks existing overlaps and raises a diagnostic before adding the constraint', () => {
    const doBlockIndex = sql.indexOf('RAISE EXCEPTION')
    const constraintIndex = sql.indexOf('ADD CONSTRAINT customer_rate_overrides_no_overlap')
    expect(doBlockIndex).toBeGreaterThan(-1)
    expect(constraintIndex).toBeGreaterThan(doBlockIndex)
  })

  it('adds a gist exclusion constraint on customer+item+daterange overlap', () => {
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS btree_gist')
    expect(sql).toContain('EXCLUDE USING gist (')
    expect(sql).toContain('customer_id WITH =,')
    expect(sql).toContain('charge_item_id WITH =,')
    expect(sql).toContain("daterange(valid_from, valid_to, '[]') WITH &&")
  })

  it('redefines calculate_bl_local_charges without the created_at tie-break', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.calculate_bl_local_charges\b/)
    expect(sql).not.toContain('ORDER BY cro.created_at DESC')
    expect(sql).toContain("IF v_bl.financial_status IN ('invoiced', 'partially_paid', 'paid') THEN")
  })
})
