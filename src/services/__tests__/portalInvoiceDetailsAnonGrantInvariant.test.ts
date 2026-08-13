import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Revisao do PR 527 (achado 2): portal_invoice_details(bigint) ja teve o
// EXECUTE de anon reconcedido varias vezes (084, 085, 105, 120, 123, 261)
// sobre um REVOKE anterior (114, 150), porque cada CREATE OR REPLACE novo
// copiou o boilerplate `TO authenticated, anon` de uma versao anterior da
// funcao. A migration 290 fecha o buraco de novo, mas so um REVOKE pontual
// nao impede a proxima edicao de reabrir o mesmo jeito. Este teste varre
// TODAS as migrations em ordem numerica e trava que o ultimo GRANT/REVOKE
// que menciona anon para essa funcao seja um REVOKE -- se uma migration
// futura reconceder EXECUTE a anon sem revogar de novo depois, o teste
// quebra em vez de o buraco ficar silencioso ate a proxima auditoria.
describe('invariante: anon nunca mantem EXECUTE em portal_invoice_details(bigint)', () => {
  it('a ultima concessao/revogacao envolvendo anon, em ordem de migration, e uma revogacao', () => {
    const dir = path.resolve(process.cwd(), 'supabase/migrations')
    const files = fs.readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()

    const grantRe = /GRANT EXECUTE ON FUNCTION public\.portal_invoice_details\(bigint\) TO [^;]*\banon\b[^;]*;/gi
    const revokeRe = /REVOKE EXECUTE ON FUNCTION public\.portal_invoice_details\(bigint\) FROM (?:PUBLIC, )?anon;/gi

    let lastState: 'granted' | 'revoked' | 'none' = 'none'
    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8')
      const events: Array<{ index: number; state: 'granted' | 'revoked' }> = []
      for (const match of sql.matchAll(grantRe)) events.push({ index: match.index, state: 'granted' })
      for (const match of sql.matchAll(revokeRe)) events.push({ index: match.index, state: 'revoked' })
      events.sort((a, b) => a.index - b.index)
      for (const event of events) lastState = event.state
    }

    expect(lastState).toBe('revoked')
  })
})
