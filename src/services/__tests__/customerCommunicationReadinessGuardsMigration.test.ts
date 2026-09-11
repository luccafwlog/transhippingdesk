import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/033_customer_communication_readiness_guards.sql'), 'utf8')

describe('migration 033 — guards de prontidão de CE Mercante', () => {
  it('expõe uma RPC server-only que bloqueia fechado e trava os B/Ls da unidade', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.customer_local_charges_communication_dispatch_ready\(/i)
    expect(migration).toContain("auth.role() IS DISTINCT FROM 'service_role'")
    expect(migration).toContain('pg_advisory_xact_lock')
    expect(migration).toMatch(/FROM public\.bls[\s\S]*FOR UPDATE/i)
    expect(migration).toContain("USING ERRCODE = 'P0003'")
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.customer_local_charges_communication_dispatch_ready\([\s\S]*TO service_role/i)
  })

  it('aplica a mesma guarda na criação, no claim automático e no envio', () => {
    expect(migration).toContain('customer_communications_ce_mercante_readiness')
    expect(migration).toContain('customer_communication_automation_claims_ce_mercante_readiness')
    expect(migration).toContain("NEW.claim_key LIKE 'ce_mercante_taxas:%'")
    expect(migration).toContain('RETURN NULL')
  })
})
