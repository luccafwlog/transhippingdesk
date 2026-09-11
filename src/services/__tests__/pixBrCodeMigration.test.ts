import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/034_pix_static_payload_normative_fixes.sql'), 'utf8')

describe('migration 034 — payload estático Pix conforme BR Code', () => {
  it('mantém o txid somente no template 62-05 e limita a 25 caracteres', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.build_transshipping_pix_payload\(/i)
    expect(migration).toContain('FROM 1 FOR 25')
    expect(migration).toMatch(/pix_tlv\('62',\s*public\.pix_tlv\('05',\s*v_txid\)\)/i)
    const merchantAccountAssignment = migration.match(/v_merchant_account\s*:=([\s\S]*?);\s*\n\s*v_payload/i)?.[1] ?? ''
    expect(merchantAccountAssignment).not.toContain("pix_tlv('05', v_txid)")
  })

  it('recusa valor que não cabe no campo 54 e mantém a ACL server-only', () => {
    expect(migration).toContain("length(v_amount_text) > 13")
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.build_transshipping_pix_payload\([\s\S]*FROM PUBLIC, anon, authenticated/i)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.build_transshipping_pix_payload\([\s\S]*TO service_role/i)
  })
})
