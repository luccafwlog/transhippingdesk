// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { InvoiceDocumentLocal } from '../InvoiceDocumentLocal'

const pixPayload = '00020101021226880014br.gov.bcb.pix'
const detail = {
  invoice: {
    id: 9,
    invoice_number: 'INV-9',
    status: 'paid',
    total_brl: 100,
    total_paid_brl: 100,
    balance_brl: 0,
    customer_name: 'Cliente Local',
    customer_cnpj_cpf: '12345678000199',
    issued_at: '2026-06-23',
    pix_payload: pixPayload,
  },
  bls: [{ bl_id: 'BL-9', vessel_name: 'GREEN', voyage_number: '14N', pol: 'CNSHA', pod: 'BRVIX' }],
  items: [{ id: 31, bl_id: 'BL-9', description: 'Taxa manual', quantity: 1, unit_value_brl: 100, total_value_brl: 100 }],
  payments: [{ paid_at: '2026-06-25' }],
} as never

afterEach(cleanup)

it('imprime recibo de taxas locais sem PIX e com o mesmo conteúdo da fatura', () => {
  render(<InvoiceDocumentLocal detail={detail} type="receipt" />)

  expect(screen.getByText('RECIBO DE TAXAS LOCAIS')).toBeTruthy()
  expect(screen.getByText(/Cliente Local/)).toBeTruthy()
  expect(screen.getByText('Pago em 25/06/2026')).toBeTruthy()
  expect(screen.getByText('Taxa manual')).toBeTruthy()
  expect(screen.queryByText('PAGAMENTO VIA PIX')).toBeNull()
  expect(screen.queryByText(pixPayload)).toBeNull()
})
