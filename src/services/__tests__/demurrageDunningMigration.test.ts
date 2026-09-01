import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/378_demurrage_dunning_communication.sql'), 'utf8')

describe('migration 378 — régua de Demurrage', () => {
  it('usa first_billed_at, intervalo configurável e não impõe teto de cobranças', () => {
    expect(sql).toContain('first_billed_at')
    expect(sql).toContain('paid_at IS NULL')
    expect(sql).toContain('demurrage_dunning_interval_days')
    expect(sql).toContain("'0 * * * *'")
    expect(sql).toContain('demurrage_dunning_claims')
    expect(sql).toMatch(/attempt_discriminator\s+INTEGER[\s\S]*CHECK\s*\(attempt_discriminator\s*>\s*0\)/i)
    expect(sql).not.toMatch(/LIMIT\s+[1-6]\b/i)
  })

  it('pausa por disputa e por cliente sem contatos válidos após bounce', () => {
    expect(sql).toMatch(/COALESCE\(di\.dispute_open, false\) = false/i)
    expect(sql).toContain("cliente_contato_bounced_sem_alternativa")
    expect(sql).toContain("pse.reason = 'bounce_permanente'")
    expect(sql).toContain('customer_communication_suppressions')
  })
})
