import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('ledger individual invoice RPC migration', () => {
  it('defines the individual receivable RPC and routes auto emission through it', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/070_ledger_individual_invoice_rpc.sql'),
      'utf8',
    )

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.create_local_individual_invoice_from_receivable\b/)
    expect(sql).toContain('public.create_invoice_from_bls_core')
    expect(sql).toContain('public.link_invoice_to_ledger')
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.emit_invoice_on_bl_ready\b/)
    expect(sql).toContain('public.sync_local_charge_receivable')
    expect(sql).toContain('public.create_local_individual_invoice_from_receivable')
  })

  it('não mantém a RPC no mapa de tipos: a migration 268 a removeu do banco', () => {
    const drop = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/268_local_charges_usd_conversion_at_emission.sql'),
      'utf8',
    )
    const types = readFileSync(resolve(process.cwd(), 'src/types/database.ts'), 'utf8')

    expect(drop).toContain('DROP FUNCTION IF EXISTS public.create_local_individual_invoice_from_receivable')
    expect(types).not.toContain('create_local_individual_invoice_from_receivable')
  })
})
