import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('billing core wrapper privileges', () => {
  it('elevates guarded wrappers without exposing the billing core', () => {
    const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations')
    const sql = fs.readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
      .join('\n')

    expect(sql).toMatch(
      /ALTER FUNCTION public\.create_invoice_from_bls\([\s\S]*?\) SECURITY DEFINER/i,
    )
    expect(sql).toMatch(
      /ALTER FUNCTION public\.create_invoice_from_bls_with_ledger\([\s\S]*?\) SECURITY DEFINER/i,
    )
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.create_invoice_from_bls_core\([\s\S]*?\) FROM PUBLIC, anon, authenticated/i,
    )
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.create_invoice_from_bls_core\([\s\S]*?\) TO (?:anon|authenticated)/i,
    )
  })
})
