import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/377_portal_invoice_exception_audience.sql'), 'utf8')

describe('migration 377 — audiência da exceção de invoice', () => {
  it('expõe portal_excecao_critica_fatura a Documentação e Administrativo', () => {
    expect(sql).toMatch(/portal_excecao_critica_fatura/i)
    expect(sql).toMatch(/audience_departments\s*=\s*ARRAY\['documentacao',\s*'administrativo'\]/i)
  })

  it('cataloga os dois modelos financeiros e mantém a restrição sem PIX', () => {
    expect(sql).toContain("'ce_mercante_taxas'")
    expect(sql).toContain("'cobranca_demurrage'")
    expect(sql).toMatch(/customer_communication_templates_kind_check[\s\S]*ce_mercante_taxas[\s\S]*cobranca_demurrage/i)
  })
})
