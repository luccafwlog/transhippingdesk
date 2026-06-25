import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Contrato SQL: a policy SELECT de demurrage_invoice_history deve espelhar a
// tabela-pai (demurrage_invoices, restrita a is_active_user em 042) e NUNCA
// voltar ao permissivo `USING (true)`, que expunha o historico financeiro a
// clientes do Portal (authenticated). Ver migration 160.
describe('demurrage_invoice_history RLS hardening migration', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/160_demurrage_invoice_history_rls_active.sql'),
    'utf8',
  )

  it('restricts SELECT to is_active_user() and drops the permissive policy', () => {
    expect(sql).toContain('DROP POLICY IF EXISTS "authenticated_read_demurrage_invoice_history"')
    expect(sql).toContain('demurrage_invoice_history_select_active')
    expect(sql).toContain('FOR SELECT')
    expect(sql).toContain('public.is_active_user()')
  })

  it('does not reintroduce a permissive USING (true) SELECT policy', () => {
    // Garante que a correcao nao deixou nenhum SELECT aberto a qualquer authenticated.
    expect(sql).not.toMatch(/FOR SELECT[\s\S]*USING \(true\)/)
  })
})
