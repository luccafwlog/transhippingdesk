import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/231_vazios_grao_container.sql'), 'utf8')

describe('migration do grao-container', () => {
  it('troca a identidade para viagem e container e adiciona campos operacionais', () => {
    expect(sql).toContain('ALTER COLUMN container_number SET NOT NULL')
    expect(sql).toContain('uq_vazios_bookings_voyage_container')
    expect(sql).toContain("condition IN ('empty', 'damage', 'material')")
    expect(sql).toContain('overtime_handling_pct')
  })
})
