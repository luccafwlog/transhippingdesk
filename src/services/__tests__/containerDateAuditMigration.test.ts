import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations')

function readMigrations() {
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    // Normalize CRLF so the content assertions are independent of git's
    // core.autocrlf checkout behaviour (the committed files use LF).
    .map((file) => fs.readFileSync(path.join(migrationsDir, file), 'utf8').replace(/\r\n/g, '\n'))
    .join('\n')
}

describe('container date audit migrations', () => {
  it('provides one atomic RPC that updates dates and writes their audit trail', () => {
    const sql = readMigrations()
    expect(sql).toContain('update_container_demurrage_dates')
    expect(sql).toContain("entity_type,\n      entity_id,\n      field_name")
    expect(sql).toContain("'discharge_date'")
    expect(sql).toContain("'return_date'")
    expect(sql).toContain('FOR UPDATE')
  })

  it('propagates voyage ATA corrections only to derived container dates', () => {
    const sql = readMigrations()
    expect(sql).toContain('propagate_voyage_ata_to_containers')
    expect(sql).toContain('OLD.ata')
    expect(sql).toContain('c.discharge_date IS NULL OR c.discharge_date = OLD.ata::date')
    expect(sql).toContain("field_name")
  })
})
