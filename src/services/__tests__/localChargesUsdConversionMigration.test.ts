import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('local charges usd conversion at emission migration (268)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/268_local_charges_usd_conversion_at_emission.sql'),
    'utf8',
  )

  it('drops the auto-emit trigger and the functions only it used', () => {
    expect(sql).toContain('DROP TRIGGER IF EXISTS trg_emit_invoice_on_bl_ready ON public.bls;')
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.emit_invoice_on_bl_ready();')
    expect(sql).toContain(
      'DROP FUNCTION IF EXISTS public.create_local_individual_invoice_from_receivable(BIGINT, DATE, TEXT, UUID);',
    )
  })

  it('calculate_bl_local_charges no longer holds USD lines for manual adjustment', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.calculate_bl_local_charges\b/)
    expect(sql).not.toContain('Linhas em USD exigem ajuste manual antes do faturamento.')
  })

  it('mark_bl_ready_for_billing no longer blocks on USD lines and counts them as invoiceable', () => {
    const fnIndex = sql.indexOf('CREATE OR REPLACE FUNCTION public.mark_bl_ready_for_billing')
    const nextFnIndex = sql.indexOf('CREATE OR REPLACE FUNCTION public.create_invoice_from_bls_core')
    const body = sql.slice(fnIndex, nextFnIndex)
    expect(body).not.toContain('Existem linhas em USD que bloqueiam o ready_for_billing.')
    expect(body).toContain("(COALESCE(total_value_brl, 0) > 0 OR COALESCE(total_value_usd, 0) > 0)")
  })

  it('mark_bl_ready_for_billing syncs the ledger receivable instead of emitting an invoice', () => {
    const fnIndex = sql.indexOf('CREATE OR REPLACE FUNCTION public.mark_bl_ready_for_billing')
    const nextFnIndex = sql.indexOf('CREATE OR REPLACE FUNCTION public.create_invoice_from_bls_core')
    const body = sql.slice(fnIndex, nextFnIndex)
    expect(body).toContain('PERFORM public.sync_local_charge_receivable(p_bl_id);')
  })

  it('sync_local_charge_receivable converts USD lines via the current ROE and drops the admin-only gate', () => {
    const fnIndex = sql.indexOf('CREATE OR REPLACE FUNCTION public.sync_local_charge_receivable')
    const nextFnIndex = sql.indexOf('CREATE OR REPLACE FUNCTION public.mark_bl_ready_for_billing')
    const body = sql.slice(fnIndex, nextFnIndex)
    expect(body).not.toContain('NOT public.is_admin()')
    expect(body).toContain('NOT public.is_active_user()')
    expect(body).toContain('ROUND(cc.total_value_usd * v_roe, 2)')
  })

  it('create_invoice_from_bls_core converts USD to BRL via the exchange_rate_reference roe instead of hard-blocking', () => {
    const fnIndex = sql.indexOf('CREATE OR REPLACE FUNCTION public.create_invoice_from_bls_core')
    const nextFnIndex = sql.indexOf('CREATE OR REPLACE FUNCTION public.create_local_consolidated_invoice_core')
    const body = sql.slice(fnIndex, nextFnIndex)
    expect(body).not.toContain('Existem linhas em USD. Ajuste manualmente antes de faturar.')
    expect(body).toContain('FROM public.exchange_rate_reference WHERE id = 1')
    expect(body).toContain("(COALESCE(cc.total_value_brl, 0) > 0 OR COALESCE(cc.total_value_usd, 0) > 0)")
    expect(body).toContain("'roe', CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN v_roe ELSE NULL END")
  })

  it('create_local_consolidated_invoice_core includes USD-only lines and converts them via roe', () => {
    const fnIndex = sql.indexOf('CREATE OR REPLACE FUNCTION public.create_local_consolidated_invoice_core')
    const body = sql.slice(fnIndex)
    expect(body).toContain("(COALESCE(cc.total_value_brl, 0) > 0 OR COALESCE(cc.total_value_usd, 0) > 0)")
    expect(body).toContain('ROUND(COALESCE(cc.total_value_usd, 0) * v_roe, 2)')
  })
})
