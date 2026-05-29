import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('ledger individual invoice RPC migration', () => {
  it('defines the individual receivable RPC and routes auto emission through it', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260529140000_ledger_individual_invoice_rpc.sql'),
      'utf8',
    )

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.create_local_individual_invoice_from_receivable\b/)
    expect(sql).toContain('public.create_invoice_from_bls_core')
    expect(sql).toContain('public.link_invoice_to_ledger')
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.emit_invoice_on_bl_ready\b/)
    expect(sql).toContain('public.sync_local_charge_receivable')
    expect(sql).toContain('public.create_local_individual_invoice_from_receivable')
  })

  it('keeps the local Supabase type map aware of the RPC', () => {
    const types = readFileSync(resolve(process.cwd(), 'src/types/database.ts'), 'utf8')

    expect(types).toContain('create_local_individual_invoice_from_receivable')
    expect(types).toContain('p_receivable_id: number')
    expect(types).toContain('p_due_date: string | null')
  })
})
