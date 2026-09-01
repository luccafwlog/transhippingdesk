import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'supabase/functions/demurrage-dunning/index.ts'), 'utf8')

describe('Edge Function demurrage-dunning', () => {
  it('usa segredo próprio, claim transacional e template financeiro', () => {
    expect(source).toContain('DEMURRAGE_DUNNING_SECRET')
    expect(source).toContain("admin.rpc('claim_demurrage_dunning_candidates'")
    expect(source).toContain("renderDemurrageTemplate")
    expect(source).toContain("kind: 'cobranca_demurrage'")
    expect(source).toContain("p_anchor_invoice_id: candidate.invoice_id")
  })

  it('respeita a chave global, contatos/supressões e o reply-to dedicado', () => {
    expect(source).toContain("communications_enabled")
    expect(source).toContain("customer_communication_suppressions")
    expect(source).toContain("bounce_permanente")
    expect(source).toContain("COMMUNICATIONS_REPLY_TO")
    expect(source).toContain('first_billed_at')
    expect(source).toContain('attempt_discriminator')
  })
})
