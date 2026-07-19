import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/206_portal_notifications_bl_id.sql', 'utf8')

describe('206_portal_notifications_bl_id', () => {
  it('adiciona bl_id opcional com FK', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS bl_id TEXT/)
    expect(sql).toMatch(/REFERENCES public\.bls\(id\) ON DELETE SET NULL/)
  })
  it('reaplica omit_voyage_escala e set_bl_cod preenchendo bl_id', () => {
    for (const fn of ['omit_voyage_escala', 'set_bl_cod']) {
      const body = sql.match(new RegExp(`FUNCTION public\\.${fn}[\\s\\S]*?\\$function\\$;`, 'i'))?.[0] ?? ''
      expect(body).toMatch(/INSERT INTO public\.portal_notifications\s*\([^)]*bl_id/i)
    }
  })
})
