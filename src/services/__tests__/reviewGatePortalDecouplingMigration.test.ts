import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/188_review_gate_remove_portal.sql', 'utf8')

describe('portal decoupling migration', () => {
  it('keeps customer email and breakbulk weight gates while removing portal readiness', () => {
    expect(sql).toContain("Cliente sem e-mail cadastrado")
    expect(sql).toContain("Peso BB ausente")
    expect(sql).not.toContain('customer_portal_accounts')
    expect(sql).not.toContain('Acesso ao portal nao provisionado')
  })
})
