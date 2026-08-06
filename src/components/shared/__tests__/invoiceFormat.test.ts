import { describe, expect, it } from 'vitest'
import { describeInvoiceItemsFreezeNote } from '../invoiceFormat'

// Etapa 1 do plano de faturamento (ADR 0038, achado 3): a nota de "detalhamento
// congelado" só vale para invoice individual (snapshot real em invoice_items).
// Consolidada reconstrói o breakdown ao vivo de charge_calculations — dizer
// "congelado" ali seria enganoso (docs/modules/faturamento.md, "Breakdown derivado").
describe('describeInvoiceItemsFreezeNote', () => {
  it('afirma congelamento para invoice individual', () => {
    const note = describeInvoiceItemsFreezeNote({ invoice_type: 'individual', issued_at: '2026-06-23' })
    expect(note).toContain('congelado na emissão')
    expect(note).toContain('23/06/2026')
  })

  it('descreve o congelamento no momento da consolidação para invoice consolidada', () => {
    const note = describeInvoiceItemsFreezeNote({ invoice_type: 'consolidated', issued_at: '2026-06-23' })
    expect(note).toContain('congelado no momento da consolidação')
  })
})
