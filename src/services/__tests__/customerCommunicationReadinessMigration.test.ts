import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/376_customer_local_charges_communication_readiness.sql'), 'utf8')

describe('migration 376 — prontidão financeira de Comunicados', () => {
  it('expõe uma RPC por cliente e viagem, com guarda interna e grants de leitura', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.customer_local_charges_communication_readiness\(\s*p_voyage_id BIGINT,\s*p_customer_id BIGINT\s*\)/i)
    expect(sql).toMatch(/RETURNS JSONB[\s\S]*SECURITY DEFINER[\s\S]*is_active_read_user\(\)[\s\S]*42501/i)
    expect(sql).toContain("auth.role() IS DISTINCT FROM 'service_role'")
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.customer_local_charges_communication_readiness\(BIGINT, BIGINT\)[\s\S]*TO service_role, authenticated/i)
  })

  it('mantém CE, revisão, faturamento e exclusão de cancelados no mesmo veredito', () => {
    expect(sql).toContain('compute_bl_review_pendencies(')
    expect(sql).toMatch(/financial_status NOT IN \('invoiced', 'paid'\)/i)
    expect(sql).toMatch(/financial_status[^\n]*<> 'cancelled'/i)
    expect(sql).toContain('ce_mercante_ausente')
    expect(sql).toContain('revisao_pendente')
    expect(sql).toContain('faturamento_pendente')
  })
})
