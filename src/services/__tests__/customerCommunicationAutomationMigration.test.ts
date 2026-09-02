import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = [381, 382].map((version) => readFileSync(new URL(`../../../supabase/migrations/${version}_customer_communications_${version === 381 ? 'automation' : 'automation_reliability'}.sql`, import.meta.url), 'utf8')).join('\n')

describe('contrato SQL da automação de Comunicados', () => {
  it('protege o runner por service_role, mantém claims idempotentes, suporta liberação e agenda o detector', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.evaluate_and_dispatch_automatic_communications\(/)
    expect(sql).toMatch(/IF auth\.role\(\) IS DISTINCT FROM 'service_role'/)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.customer_communication_automation_claims/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.release_customer_communication_automation_claim\(/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.release_customer_communication_automation_claim\(TEXT\) TO service_role/)
    expect(sql).toMatch(/ON CONFLICT \(claim_key\) DO UPDATE/)
    expect(sql).toMatch(/customer_communication_safe_timestamptz/)
    expect(sql).toMatch(/l\.ata IS NULL AND v_as_of < l\.eta AND l\.eta BETWEEN/)
    expect(sql).toMatch(/l\.ata IS NOT NULL AND l\.ata BETWEEN/)
    expect(sql).toMatch(/released_at IS NOT NULL|claimed_at < v_as_of - interval '30 minutes'/)
    expect(sql).toMatch(/cron\.schedule\(/)
    expect(sql).toMatch(/'customer-communication-auto-runner'/)
  })
})
