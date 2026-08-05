import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Auditoria de seguranca 2026-08-05 (docs/archive/audits/): o cliente do Portal
// recebe o MESMO role `authenticated` do usuario interno, entao objeto que
// confia so em "estar autenticado" vaza para ele. Estes contratos travam o
// fechamento feito pela migration 257.
describe('fronteira do Portal sobre o role authenticated (migration 257)', () => {
  const migration = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/257_portal_authenticated_boundary_hardening.sql'),
    'utf8',
  )

  it('guarda list_billing_runs por identidade interna, preservando o uso interno', () => {
    const listBillingRuns = migration.slice(
      migration.indexOf('FUNCTION public.list_billing_runs'),
      migration.indexOf('mark_overdue_invoices'),
    )
    expect(listBillingRuns).toMatch(/WHERE public\.is_active_read_user\(\)/)
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.list_billing_runs\(INTEGER\) TO authenticated, service_role/,
    )
  })

  // A funcao roda no job pg_cron `mark-overdue-invoices`, que executa sem JWT.
  // Guarda por identidade quebraria o job; a fronteira tem de ser o grant.
  it('fecha mark_overdue_invoices pelo grant, sem guarda de identidade que quebre o pg_cron', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.mark_overdue_invoices\(\) FROM PUBLIC, anon, authenticated/,
    )
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.mark_overdue_invoices\(\) TO service_role;/,
    )
    expect(migration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.mark_overdue_invoices\(\) TO [^;]*authenticated/,
    )
    expect(migration).not.toMatch(/CREATE OR REPLACE FUNCTION public\.mark_overdue_invoices/)
  })

  it('fecha a escrita de check_provision_rate_limit ao cliente e ao anonimo', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.check_provision_rate_limit\(UUID\) FROM PUBLIC, anon, authenticated/,
    )
    expect(migration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.check_provision_rate_limit\(UUID\) TO [^;]*authenticated/,
    )
  })

  it('fecha o oraculo bl_has_portal_release ao cliente e ao anonimo', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.bl_has_portal_release\(TEXT\) FROM PUBLIC, anon, authenticated/,
    )
    expect(migration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.bl_has_portal_release\(TEXT\) TO (?:anon|authenticated)/,
    )
  })

  // O projeto tem ALTER DEFAULT PRIVILEGES concedendo EXECUTE a anon e
  // authenticated em toda funcao nova de `public`. Revogar so PUBLIC nao basta:
  // o grant dos dois roles e explicito e sobrevive.
  it('revoga PUBLIC e anon explicitamente em toda funcao tocada', () => {
    for (const fn of [
      /REVOKE ALL ON FUNCTION public\.list_billing_runs\(INTEGER\) FROM PUBLIC, anon/,
      /REVOKE ALL ON FUNCTION public\.mark_overdue_invoices\(\) FROM PUBLIC, anon/,
      /REVOKE ALL ON FUNCTION public\.check_provision_rate_limit\(UUID\) FROM PUBLIC, anon/,
      /REVOKE ALL ON FUNCTION public\.bl_has_portal_release\(TEXT\) FROM PUBLIC, anon/,
    ]) {
      expect(migration).toMatch(fn)
    }
  })

  it('substitui as policies USING (true) por leitura restrita ao usuario interno', () => {
    expect(migration).toMatch(/DROP POLICY IF EXISTS "vessel_schedules_select_authenticated"/)
    expect(migration).toMatch(/DROP POLICY IF EXISTS "Authenticated users can view ended vessels"/)

    const policies = migration.slice(migration.indexOf('DROP POLICY IF EXISTS "vessel_schedules_select_authenticated"'))
    expect(policies.match(/USING \(public\.is_active_read_user\(\)\)/g)).toHaveLength(2)
    expect(policies).not.toMatch(/USING \(true\)/)
  })

  it('nao deixa nenhuma policy de SELECT com USING (true) no schema', () => {
    const dir = path.resolve(process.cwd(), 'supabase/migrations')
    const all = fs.readdirSync(dir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => fs.readFileSync(path.join(dir, file), 'utf8'))
      .join('\n')

    // As duas unicas policies FOR SELECT ... USING (true) que existiram sao as
    // fechadas aqui; ambas precisam ter um DROP posterior na historia.
    const abertas = all.match(/CREATE POLICY "([^"]+)"[^;]*?FOR SELECT[^;]*?USING \(true\)/gis) ?? []
    for (const criacao of abertas) {
      const nome = /CREATE POLICY "([^"]+)"/i.exec(criacao)?.[1]
      expect(nome, `policy ${nome} nasce aberta e precisa de DROP`).toBeTruthy()
      expect(all, `policy ${nome} continua aberta a qualquer autenticado`).toMatch(
        new RegExp(`DROP POLICY[^;]*"${nome}"`, 'i'),
      )
    }
  })

  it('remove o caminho morto de leitura de vessel_schedules pela sessao do Portal', () => {
    const raiz = process.cwd()
    expect(fs.existsSync(path.join(raiz, 'src/services/vesselSchedules.ts'))).toBe(false)
    expect(fs.existsSync(path.join(raiz, 'src/hooks/useVesselSchedules.ts'))).toBe(false)
  })
})
