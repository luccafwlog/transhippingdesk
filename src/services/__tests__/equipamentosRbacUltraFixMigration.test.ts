import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/212_fix_equipamentos_rbac_contract.sql',
)
const runtimeTestPath = resolve(
  process.cwd(),
  'supabase/tests/212_equipamentos_rbac_runtime.sql',
)
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : ''
const normalizedSql = sql.replace(/\s+/g, ' ').trim()

const readRpcSignatures = [
  'list_bl_local_charge_lines(text)',
  'list_manual_charge_items_for_bl(text)',
  'get_billing_run_details(bigint)',
  'list_customer_reconciliation_queue(text,integer)',
  'list_consolidatable_receivables(bigint,bigint,text)',
  'get_consolidated_invoice_item_breakdown(bigint)',
  'bl_timeline(text,integer,integer)',
  'get_customer_portal_account(bigint)',
  'get_bl_portal_status(text)',
] as const

const internalWriteBypasses = [
  'ensure_pricing_rule_version(bigint,bigint,bigint,date,jsonb)',
  'sync_customer_reconciliation_queue_for_bl(text)',
  'insert_billing_run_log(bigint,bigint,text,text,text,text,jsonb)',
  'link_invoice_to_ledger(bigint)',
] as const

const externalWriteBypass = 'save_exchange_rate_reference(numeric,numeric,date)'

describe('migration 212 — correcao ultra do RBAC de Equipamentos', () => {
  it('existe como migration aditiva e preserva o helper central de escrita', () => {
    expect(existsSync(migrationPath)).toBe(true)
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.is_active_user()')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.is_equipamentos_user()')
  })

  it('enumera exatamente os nove RPCs autenticados de leitura afetados', () => {
    expect(readRpcSignatures).toHaveLength(9)

    for (const signature of readRpcSignatures) {
      const declaration = `'public.${signature}'::REGPROCEDURE`
      expect(sql, signature).toContain(declaration)
      expect(sql.split(declaration), signature).toHaveLength(2)
    }
  })

  it('troca o gate pelo catalogo sem copiar parcialmente as definicoes finais', () => {
    expect(sql).toContain('pg_get_functiondef(v_read_rpc::OID)')
    expect(sql).toContain(
      "replace(v_definition, 'is_active_user()', 'is_active_read_user()')",
    )
    expect(sql).toContain("position('is_active_read_user()' IN v_definition)")
    expect(sql).toContain('EXECUTE v_definition')
    expect(sql).toContain('RAISE EXCEPTION')
  })

  it('revoga chamada direta dos quatro helpers DEFINER internos para PUBLIC, anon e authenticated', () => {
    expect(internalWriteBypasses).toHaveLength(4)

    for (const signature of internalWriteBypasses) {
      expect(normalizedSql, signature).toContain(
        `REVOKE EXECUTE ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated;`,
      )
      expect(normalizedSql, signature).not.toContain(
        `GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated`,
      )
    }
  })

  it('fecha o quinto bypass no RPC externo de cambio sem remover service_role nem os demais perfis ativos', () => {
    expect([...internalWriteBypasses, externalWriteBypass]).toHaveLength(5)
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.save_exchange_rate_reference(')
    expect(sql).toContain("auth.role() IS DISTINCT FROM 'service_role'")
    expect(sql).toContain('NOT public.is_active_non_equipamentos_user()')
    expect(normalizedSql).toContain(
      `REVOKE ALL ON FUNCTION public.${externalWriteBypass} FROM PUBLIC, anon;`,
    )
    expect(normalizedSql).toContain(
      `GRANT EXECUTE ON FUNCTION public.${externalWriteBypass} TO authenticated, service_role;`,
    )
  })

  it('restaura INSERT e UPDATE de tarifas para ativos nao Equipamentos e conserva DELETE admin-only', () => {
    expect(sql).toContain("tablename = 'vazios_reorg_rates'")
    expect(sql).toMatch(
      /CREATE POLICY vazios_reorg_rates_insert_non_equipamentos[\s\S]*?WITH CHECK \(public\.is_active_non_equipamentos_user\(\)\)/,
    )
    expect(sql).toMatch(
      /CREATE POLICY vazios_reorg_rates_update_non_equipamentos[\s\S]*?USING \(public\.is_active_non_equipamentos_user\(\)\)[\s\S]*?WITH CHECK \(public\.is_active_non_equipamentos_user\(\)\)/,
    )
    expect(sql).toMatch(
      /CREATE POLICY vazios_reorg_rates_delete_admin[\s\S]*?USING \(public\.is_admin\(\)\)/,
    )
    expect(sql).not.toContain('CREATE POLICY vazios_reorg_rates_insert_admin')
    expect(sql).not.toContain('CREATE POLICY vazios_reorg_rates_update_admin')
  })

  it('mantem um teste SQL de runtime com os nove reads, cinco bypasses e tres papeis', () => {
    expect(existsSync(runtimeTestPath)).toBe(true)
    const runtimeSql = existsSync(runtimeTestPath) ? readFileSync(runtimeTestPath, 'utf8') : ''

    for (const signature of readRpcSignatures) {
      expect(runtimeSql, signature).toContain(`public.${signature}`)
    }
    for (const signature of [...internalWriteBypasses, externalWriteBypass]) {
      expect(runtimeSql, signature).toContain(`public.${signature}`)
    }

    expect(runtimeSql).toContain("'equipamentos'")
    expect(runtimeSql).toContain("'documentacao'")
    expect(runtimeSql).toContain("'administrativo'")
    expect(runtimeSql).toContain('vazios_reorg_rates')
  })
})
