import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Contrato estático da migration 166 (#321). Replay funcional validado no
// Postgres descartável (scripts/setup-local-pg.sh).
const sql = fs.readFileSync(
  path.resolve('supabase/migrations/166_bl_import_party_blocks.sql'),
  'utf8',
)

const BLOCKS = ['consignee_block', 'shipper_block', 'notify_block', 'notify2_block', 'notify_cnpj_cpf']

describe('166 bl import party blocks migration', () => {
  it('lê cada bloco do payload (temp table)', () => {
    for (const f of BLOCKS) expect(sql).toContain(`NULLIF(bl->>'${f}', '')`)
  })
  it('persiste cada bloco no ON CONFLICT (com guarda payload ?)', () => {
    for (const f of BLOCKS) {
      expect(sql).toContain(`${f} = CASE WHEN EXISTS`)
      expect(sql).toContain(`t.payload ? '${f}'`)
    }
  })
})
