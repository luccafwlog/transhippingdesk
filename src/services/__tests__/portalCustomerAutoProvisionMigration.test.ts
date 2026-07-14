import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/193_portal_account_on_customer_insert.sql', 'utf8')

describe('Portal customer auto-provisioning migration (193)', () => {
  it('creates the queue record securely after every customer insert', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_create_account_on_customer_insert\(\)/i)
    expect(sql).toMatch(/SECURITY DEFINER/i)
    expect(sql).toMatch(/SET search_path TO 'public', 'pg_temp'/i)
    expect(sql).toMatch(/AFTER INSERT ON public\.customers/i)
    expect(sql).toMatch(/CREATE TRIGGER trg_portal_create_account_on_customer_insert/i)
    expect(sql).toMatch(/active\s*,\s*provisioning_decision\s*,\s*account_situation\s*,\s*login_cnpj/i)
    expect(sql).toContain("false, 'aguardando_analise', 'sem_conta'")
    expect(sql).toMatch(/regexp_replace\(NEW\.cnpj_cpf, '\\D', '', 'g'\)/i)
    expect(sql).toMatch(/ON CONFLICT \(customer_id\) DO NOTHING/i)
  })

  it('records a system audit event without creating Auth or email data', () => {
    expect(sql).toMatch(/INSERT INTO public\.portal_provisioning_events/i)
    expect(sql).toMatch(/'sistema', NULL/i)
    expect(sql).toContain('Conta de Portal criada automaticamente no cadastro do Cliente.')
    expect(sql).not.toMatch(/INSERT INTO\s+auth\./i)
    expect(sql).not.toMatch(/portal_invites/i)
    expect(sql).not.toMatch(/RESEND_API_KEY/i)
  })

  it('repairs existing customers without duplicating their queue records', () => {
    expect(sql).toMatch(/FROM public\.customers c/i)
    expect(sql).toMatch(/FROM public\.customer_portal_accounts a/i)
    expect(sql).toMatch(/WHERE NOT EXISTS\s*\([\s\S]*a\.customer_id = c\.id/i)
    expect(sql).toContain('Reparo automático da conta de Portal para Cliente existente.')
  })
})
