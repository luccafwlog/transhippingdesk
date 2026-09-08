import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('S08-B/C — autoridade financeira e snapshot de Demurrage', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/023_demurrage_calculation_snapshot.sql'),
    'utf8',
  )

  it('mantém a foto de cálculo append-only e aceita PTAX ausente apenas quando a origem é manual', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.demurrage_calculation_snapshots/)
    expect(sql).toContain('input_hash text NOT NULL')
    expect(sql).toContain('demurrage_calculation_snapshots_append_only')
    expect(sql).toContain('ALTER COLUMN ptax_used DROP NOT NULL')
    expect(sql).toContain("IF v_invoice.roe_source = 'manual' THEN")
  })

  it('expõe emissão server-side por identidade de containers, sem aceitar valores calculados pelo browser', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.create_demurrage_invoice_authoritative\(/)
    expect(sql).toContain('p_container_ids bigint[]')
    expect(sql).toContain('public.bl_containers AS container')
    expect(sql).toContain('customer_demurrage_agreements')
    expect(sql).toContain('demurrage_rates')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.capture_demurrage_calculation_snapshot()')
  })

  it('fecha escritores PIX client-side e não fabrica payload na leitura de Demurrage', () => {
    const demurrage = readFileSync(
      resolve(process.cwd(), 'src/services/demurrage/demurrageInvoices.ts'),
      'utf8',
    )
    const billing = readFileSync(resolve(process.cwd(), 'src/services/billing.ts'), 'utf8')
    expect(demurrage).not.toContain('buildTransshippingPixPayload')
    expect(billing).not.toContain('persistPixPayload')
    expect(billing).not.toContain('backfillInvoicePixPayload')
  })
})
