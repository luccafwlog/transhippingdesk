import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('customer demurrage agreements migration (366)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/366_customer_demurrage_agreements.sql'),
    'utf8',
  )

  it('creates the customer_demurrage_agreements table with correct columns and checks', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.customer_demurrage_agreements')
    expect(sql).toContain('customer_id')
    expect(sql).toContain('free_days')
    expect(sql).toContain('p1_usd')
    expect(sql).toContain('p2_usd')
    expect(sql).toContain('valid_from')
    expect(sql).toContain('valid_to')
    expect(sql).toContain('active')
    expect(sql).toContain('notes')
  })

  it('adds a gist exclusion constraint to prevent overlapping active date ranges for the same customer', () => {
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS btree_gist')
    expect(sql).toContain('EXCLUDE USING gist (')
    expect(sql).toContain('customer_id WITH =,')
    expect(sql).toContain("daterange(valid_from, valid_to, '[]') WITH &&")
    expect(sql).toContain('WHERE (active = true)')
  })

  it('enables row level security and configures policies', () => {
    expect(sql).toContain('ALTER TABLE public.customer_demurrage_agreements ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('autenticados_leem_customer_demurrage_agreements')
    expect(sql).toContain('admin_gerencia_customer_demurrage_agreements')
  })

  it('adds updated_at maintenance trigger', () => {
    expect(sql).toContain('set_customer_demurrage_agreements_updated_at')
    expect(sql).toContain('EXECUTE FUNCTION public.set_updated_at()')
  })
})
