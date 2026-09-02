import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(new URL('../../../supabase/migrations/381_customer_communications_automation.sql', import.meta.url), 'utf8')

describe('contrato SQL da automação de Comunicados', () => {
  it('protege o runner por service_role, mantém claims idempotentes, suporta liberação e agenda o detector', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.evaluate_and_dispatch_automatic_communications\(/)
    expect(sql).toMatch(/IF auth\.role\(\) IS DISTINCT FROM 'service_role'/)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.customer_communication_automation_claims/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.release_customer_communication_automation_claim\(/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.release_customer_communication_automation_claim\(TEXT\) TO service_role/)
    expect(sql).toMatch(/ON CONFLICT \(claim_key\) DO UPDATE/)
    expect(sql).toMatch(/cron\.schedule\(/)
    expect(sql).toMatch(/'customer-communication-auto-runner'/)
  })
})
