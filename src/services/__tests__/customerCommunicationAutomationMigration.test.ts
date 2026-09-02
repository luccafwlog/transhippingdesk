import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = [
  readFileSync(new URL('../../../supabase/migrations/381_customer_communications_automation.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../../../supabase/migrations/382_customer_communications_automation_reliability.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../../../supabase/migrations/383_comunicados_financeiros_revisao_fixes.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../../../supabase/migrations/384_comunicados_automacao_falhas.sql', import.meta.url), 'utf8'),
].join('\n')

describe('contrato SQL da automação de Comunicados', () => {
  it('protege o runner por service_role, mantém claims idempotentes, suporta liberação e agenda o detector', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.evaluate_and_dispatch_automatic_communications\(/)
    expect(sql).toMatch(/IF auth\.role\(\) IS DISTINCT FROM 'service_role'/)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.customer_communication_automation_claims/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.release_customer_communication_automation_claim\(/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.release_customer_communication_automation_claim\(TEXT\) TO service_role/)
    expect(sql).toMatch(/ON CONFLICT \(claim_key\) DO UPDATE/)
    expect(sql).toMatch(/customer_communication_safe_timestamptz/)
    expect(sql).toMatch(/v_as_of >= l\.eta - interval '5 days' AND v_as_of < l\.eta/)
    expect(sql).toMatch(/l\.ata IS NOT NULL AND l\.ata BETWEEN v_as_of - interval '30 days' AND v_as_of/)
    expect(sql).toMatch(/released_at IS NOT NULL|claimed_at < v_as_of - interval '30 minutes'/)
    expect(sql).toMatch(/cron\.schedule\(/)
    expect(sql).toMatch(/'customer-communication-auto-runner'/)
  })

  it('migration 383/384 filtra supressões, deduplica automação e otimiza payload de taxas locais', () => {
    expect(sql).toMatch(/pse\.reason = 'bounce_permanente'/)
    expect(sql).toMatch(/FROM public\.customer_communication_suppressions ccs/)
    expect(sql).toMatch(/sent\.status = 'enviado'/)
    expect(sql).toMatch(/array_agg\(DISTINCT b\.id ORDER BY b\.id\)/)
    expect(sql).toMatch(/customer_local_charges_communication_readiness/)
    expect(sql).toMatch(/JOIN base_bls b ON b\.bl_id = ib\.bl_id/)
    expect(sql).toMatch(/JOIN base_bls b ON b\.bl_id = rl\.bl_id/)
  })
})
