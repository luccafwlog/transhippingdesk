import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Auditoria de seguranca 2026-08-12 (docs/archive/audits/): import_manifest_transactional
// era SECURITY DEFINER com EXECUTE para authenticated e sem guarda de identidade
// -- uma sessao de cliente do Portal criava import_batches/bls em viagem
// arbitraria, com autoria (p_uploaded_by) de sua escolha. Estes contratos travam
// o fechamento feito pela migration 290.
describe('guarda de identidade em import_manifest_transactional (migration 290)', () => {
  const migration = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/290_import_manifest_identity_guard.sql'),
    'utf8',
  )

  it('exige sessao interna ativa e amarra a autoria a auth.uid()', () => {
    expect(migration).toMatch(/auth\.uid\(\) IS NULL/)
    expect(migration).toMatch(/NOT public\.is_active_user\(\)/)
    expect(migration).toMatch(/p_uploaded_by IS DISTINCT FROM auth\.uid\(\)/)
    expect(migration).toMatch(/USING ERRCODE = '42501'/)
  })

  it('revoga PUBLIC e anon explicitamente e nao concede EXECUTE a anon', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.import_manifest_transactional\([^)]*\)\s*FROM PUBLIC, anon;/,
    )
    expect(migration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.import_manifest_transactional\([^)]*\) TO [^;]*anon/,
    )
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.import_manifest_transactional\([^)]*\) TO authenticated;/,
    )
  })

  it('revoga o grant residual a anon em portal_invoice_details (achado 3.5)', () => {
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.portal_invoice_details\(bigint\) FROM anon;/i,
    )
  })
})
