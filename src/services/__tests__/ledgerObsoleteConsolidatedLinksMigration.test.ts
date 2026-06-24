import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('ledger obsolete consolidated links migration', () => {
  it('marks every active link obsolete when a consolidated invoice becomes obsolete', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/073_ledger_obsolete_consolidated_links.sql'),
      'utf8',
    )

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.mark_obsolete_consolidated_links\b/)
    expect(sql).toContain("NEW.invoice_type = 'consolidated'")
    expect(sql).toContain("NEW.status = 'obsolete'")
    expect(sql).toContain("SET status = 'obsolete'")
    expect(sql).toContain('WHERE invoice_id = NEW.id')
    expect(sql).toMatch(/CREATE TRIGGER trg_mark_obsolete_consolidated_links\b/)
  })
})
