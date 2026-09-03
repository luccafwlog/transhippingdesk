import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('billing cancel privileges', () => {
  it('elevates the guarded cancellation RPC without exposing billing tables', () => {
    // Contrato histórico: lê o arquivo morto. O snapshot consolidado (002)
    // concentra todos os grants e quebraria o `not.toMatch` por span entre
    // statements — o lado ativo é coberto por verificar_guardas.py.
    const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations_archive')
    const sql = fs.readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
      .join('\n')

    expect(sql).toMatch(
      /ALTER FUNCTION public\.cancel_invoice\([\s\S]*?\) SECURITY DEFINER/i,
    )
    expect(sql).not.toMatch(
      /GRANT (?:ALL|UPDATE)[\s\S]*?ON (?:TABLE )?public\.billing_batches[\s\S]*?TO authenticated/i,
    )
  })
})
