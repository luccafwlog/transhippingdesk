import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Brazil demurrage rates migration', () => {
  it('registers every container type from the operational table', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/279_seed_brazil_demurrage_rates.sql'),
      'utf8',
    )

    for (const type of ['20GP', '20HC', '40GP', '40HC', '20FR', '20OT', '40FR', '40OT', '20RF', '20RQ', '40RF', '40RQ']) {
      expect(sql).toContain(`('${type}'`)
    }

    expect(sql).toContain("'Brasil — dias corridos'")
    expect(sql).toContain('WHERE NOT EXISTS')
  })
})
