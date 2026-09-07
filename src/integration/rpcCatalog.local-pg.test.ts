import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip

describeLocal('S14 — catálogo de RPCs executável', () => {
  it('não deixa callers de produção apontarem para funções ausentes', () => {
    expect(() => execFileSync('node', ['scripts/check-rpc-catalog.mjs'], { encoding: 'utf8' })).not.toThrow()
  })
})

