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

  // Reconstroi o estado vivo de cada policy (table+nome) seguindo a ordem
  // numerica real das migrations, nao apenas "existe um DROP em algum lugar".
  // Um DROP + CREATE do MESMO nome dentro de uma unica migration futura (ex.:
  // reabrir 258 com USING (true) sobre "vessel_schedules_select_internal")
  // passaria pela checagem antiga baseada em texto solto; esta falha porque
  // recalcula o estado final por tabela+nome na ordem de aplicacao.
  //
  // ponytail: parser por regex, nao um parser SQL real — assume que nenhum
  // corpo de CREATE/ALTER POLICY deste schema tem ';' embutido (verdade hoje
  // em todas as ~160 policies). Upgrade: node-sql-parser se isso mudar.
  it('nenhuma policy viva no schema concede SELECT (ou ALL) com USING (true) / sem USING', () => {
    const dir = path.resolve(process.cwd(), 'supabase/migrations')
    const files = fs.readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()

    const policyName = '(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))'
    const createRe = new RegExp(`CREATE POLICY\\s+${policyName}\\s+ON\\s+(?:public\\.)?([A-Za-z_][A-Za-z0-9_]*)([\\s\\S]*?);`, 'gi')
    const dropRe = new RegExp(`DROP POLICY(?:\\s+IF EXISTS)?\\s+${policyName}\\s+ON\\s+(?:public\\.)?([A-Za-z_][A-Za-z0-9_]*)`, 'gi')
    const alterRe = new RegExp(`ALTER POLICY\\s+${policyName}\\s+ON\\s+(?:public\\.)?([A-Za-z_][A-Za-z0-9_]*)([\\s\\S]*?);`, 'gi')

    type PolicyState = { command: string; hasUsingTrue: boolean; hasNoUsing: boolean; definedIn: string }
    const live = new Map<string, PolicyState>()

    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8')
      const ops: { index: number; kind: 'create' | 'drop' | 'alter'; name: string; table: string; body: string }[] = []

      for (const re of [createRe, dropRe, alterRe]) re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = createRe.exec(sql))) ops.push({ index: m.index, kind: 'create', name: (m[1] ?? m[2])!, table: m[3]!, body: m[4]! })
      while ((m = dropRe.exec(sql))) ops.push({ index: m.index, kind: 'drop', name: (m[1] ?? m[2])!, table: m[3]!, body: '' })
      while ((m = alterRe.exec(sql))) ops.push({ index: m.index, kind: 'alter', name: (m[1] ?? m[2])!, table: m[3]!, body: m[4]! })
      ops.sort((a, b) => a.index - b.index)

      for (const op of ops) {
        const key = `${op.table}::${op.name}`
        if (op.kind === 'drop') {
          live.delete(key)
          continue
        }
        const forMatch = /FOR\s+(SELECT|INSERT|UPDATE|DELETE|ALL)/i.exec(op.body)
        const command = op.kind === 'create' ? (forMatch ? forMatch[1]!.toUpperCase() : 'ALL') : (live.get(key)?.command ?? 'ALL')
        const hasUsingTrue = /USING\s*\(\s*true\s*\)/i.test(op.body)
        const hasNoUsing = op.kind === 'create' ? !/USING\s*\(/i.test(op.body) : (live.get(key)?.hasNoUsing ?? false)
        live.set(key, { command, hasUsingTrue, hasNoUsing, definedIn: file })
      }
    }

    const leaking = [...live.entries()].filter(
      ([, state]) => (state.command === 'SELECT' || state.command === 'ALL') && (state.hasUsingTrue || state.hasNoUsing),
    )

    expect(
      leaking,
      `policies vivas com leitura permissiva: ${leaking.map(([key, s]) => `${key} (${s.definedIn})`).join(', ')}`,
    ).toEqual([])
  })

  it('remove o caminho morto de leitura de vessel_schedules pela sessao do Portal', () => {
    const raiz = process.cwd()
    expect(fs.existsSync(path.join(raiz, 'src/services/vesselSchedules.ts'))).toBe(false)
    expect(fs.existsSync(path.join(raiz, 'src/hooks/useVesselSchedules.ts'))).toBe(false)
  })
})
