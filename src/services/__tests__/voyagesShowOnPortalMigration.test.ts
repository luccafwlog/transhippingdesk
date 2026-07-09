import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

it('adiciona voyages.show_on_portal como boolean not null default false', () => {
  const dir = path.resolve(process.cwd(), 'supabase/migrations')
  const sql = fs.readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => fs.readFileSync(path.join(dir, file), 'utf8'))
    .join('\n')

  expect(sql).toMatch(/ALTER TABLE\s+public\.voyages\s+ADD COLUMN\s+IF NOT EXISTS\s+show_on_portal/i)
  expect(sql).toMatch(/show_on_portal\s+boolean\s+NOT NULL\s+DEFAULT\s+false/i)
})
