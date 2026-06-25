import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(resolve(process.cwd(), 'supabase/migrations', file), 'utf8')

describe('revoke anon on portal read RPCs migration', () => {
  const sql = read('150_revoke_anon_portal_read_rpcs.sql')

  const portalReadRpcs = [
    'portal_list_operation_bls()',
    'portal_list_consolidatable_receivables()',
    'portal_list_invoices()',
    'portal_invoice_details(bigint)',
    'portal_list_demurrage_invoices()',
    'portal_get_demurrage_invoice_detail(bigint)',
  ]

  it('revokes anon EXECUTE from every previously over-granted Portal read RPC (ADR 0013)', () => {
    for (const sig of portalReadRpcs) {
      expect(sql).toContain(`REVOKE EXECUTE ON FUNCTION public.${sig} FROM anon;`)
    }
  })

  it('does not re-grant anon anywhere', () => {
    expect(sql).not.toMatch(/GRANT[^;]*TO[^;]*\banon\b/)
  })
})

describe('SECURITY DEFINER active-user guard migration', () => {
  const sql = read('151_guard_definer_rpcs_active_user.sql')

  const guardedRpcs = [
    'calculate_bl_local_charges',
    'detect_overdue_invoices',
    'list_bl_local_charge_lines',
    'list_manual_charge_items_for_bl',
    'list_customer_reconciliation_queue',
  ]

  it('adds the canonical auth.uid()+is_active_user() gate to every flagged DEFINER RPC (ADR 0004)', () => {
    // Exactly five executable guards, one per function (the literal in code, not comments).
    const guards = sql.match(/IF auth\.uid\(\) IS NULL OR NOT public\.is_active_user\(\) THEN/g) ?? []
    expect(guards).toHaveLength(guardedRpcs.length)
    expect((sql.match(/RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501'/g) ?? [])).toHaveLength(
      guardedRpcs.length,
    )
  })

  it('re-creates each flagged function', () => {
    for (const fn of guardedRpcs) {
      expect(sql).toContain(`CREATE OR REPLACE FUNCTION public.${fn}`)
    }
  })

  it('converts the read functions to plpgsql so the gate can run, preserving the query via RETURN QUERY', () => {
    // No remaining SQL-language read function bodies; conversions use RETURN QUERY.
    // Strip comment lines so prose mentioning "LANGUAGE sql" does not count.
    const code = sql.replace(/^\s*--.*$/gm, '')
    expect(code).not.toMatch(/LANGUAGE\s+sql/i)
    expect((code.match(/RETURN QUERY/g) ?? [])).toHaveLength(3)
  })

  it('keeps the gate ahead of any data access in the converted readers', () => {
    for (const fn of ['list_bl_local_charge_lines', 'list_manual_charge_items_for_bl', 'list_customer_reconciliation_queue']) {
      const fnStart = sql.indexOf(`public.${fn}`)
      const guardPos = sql.indexOf('NOT public.is_active_user()', fnStart)
      const queryPos = sql.indexOf('RETURN QUERY', fnStart)
      expect(guardPos).toBeGreaterThan(fnStart)
      expect(guardPos).toBeLessThan(queryPos)
    }
  })

  it('revokes anon/PUBLIC and grants only authenticated on every re-created function', () => {
    expect((sql.match(/REVOKE ALL ON FUNCTION[^;]*FROM PUBLIC, anon;/g) ?? [])).toHaveLength(guardedRpcs.length)
    expect((sql.match(/GRANT EXECUTE ON FUNCTION[^;]*TO authenticated;/g) ?? [])).toHaveLength(guardedRpcs.length)
  })
})
