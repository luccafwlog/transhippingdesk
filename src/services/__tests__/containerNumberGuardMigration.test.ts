import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readMigration = () =>
  readFileSync(resolve(process.cwd(), 'supabase/migrations/164_guard_iso_container_numbers.sql'), 'utf8')

describe('container number guard migration', () => {
  it('normalizes existing container numbers, removes invalid rows, and adds ISO constraints', () => {
    const sql = readMigration()

    expect(sql).toMatch(/UPDATE public\.bl_containers[\s\S]+regexp_replace\(container_number, '\\s\+', '', 'g'\)/i)
    expect(sql).toMatch(/DELETE FROM public\.bl_containers[\s\S]+!~ '\^\[A-Z\]\{4\}\[0-9\]\{7\}\$'/i)
    expect(sql).toMatch(/NOT EXISTS \([\s\S]+public\.vehicles[\s\S]+container_id = bc\.id/i)
    expect(sql).toMatch(/NOT EXISTS \([\s\S]+public\.charge_calculations[\s\S]+container_id = bc\.id/i)
    expect(sql).toMatch(/NOT EXISTS \([\s\S]+public\.demurrage_invoice_items[\s\S]+container_id = bc\.id/i)
    expect(sql).toMatch(/ADD CONSTRAINT bl_containers_container_number_iso/i)
    expect(sql).toMatch(/container_number ~ '\^\[A-Z\]\{4\}\[0-9\]\{7\}\$'/i)
    expect(sql).toMatch(/bl_containers_container_number_iso[\s\S]+NOT VALID/i)

    expect(sql).toMatch(/UPDATE public\.baplie_containers[\s\S]+regexp_replace\(container_number, '\\s\+', '', 'g'\)/i)
    expect(sql).toMatch(/DELETE FROM public\.baplie_containers[\s\S]+!~ '\^\[A-Z\]\{4\}\[0-9\]\{7\}\$'/i)
    expect(sql).toMatch(/ADD CONSTRAINT baplie_containers_container_number_iso/i)
    expect(sql).toMatch(/baplie_containers_container_number_iso[\s\S]+NOT VALID/i)
  })
})
