import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/305_financeiro_taxas_locais_tables_route.sql'), 'utf8')

describe('migration 305: rota da mensagem de tabelas de taxas locais', () => {
  it('preserva a assinatura e os grants da função viva', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.mark_bl_ready_for_billing(')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.mark_bl_ready_for_billing(TEXT, UUID) FROM PUBLIC, anon;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.mark_bl_ready_for_billing(TEXT, UUID) TO authenticated;')
  })

  it('orienta o cadastro para a sub-rota de tabelas', () => {
    expect(sql).toContain('Configure em /taxas-locais/tabelas antes de prosseguir.')
  })
})
