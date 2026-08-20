import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

it('portal_ship_schedule devolve POD omitido marcado e continua ocultando POD deletado', () => {
  const dir = path.resolve(process.cwd(), 'supabase/migrations')
  const sql = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n')
  const lastDef = sql.slice(sql.lastIndexOf('CREATE OR REPLACE FUNCTION public.portal_ship_schedule'))
  expect(lastDef).toMatch(/omitted_pods/i)
  expect(lastDef).toMatch(/field_name\s*=\s*'omitted'/i)
  expect(lastDef).toMatch(/omitted\s+boolean/i)
  expect(lastDef).toMatch(/pod\.omitted/i)
  expect(lastDef).toMatch(/d\.entity_id\s+IS\s+NULL/i)
})
