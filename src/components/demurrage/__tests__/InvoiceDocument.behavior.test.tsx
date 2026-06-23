// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { DemurrageInvoiceDetail } from '../../../types/database'
import { InvoiceDocument } from '../InvoiceDocument'

const detail = {
  doc_number: 'DEM-2026-0001',
  bl_id: 'BL-9',
  frozen_roe: 5,
  roe: 5,
  frozen_total_brl: 500,
  discount_value: 0,
  discount_mode: null,
  due_date: '2026-07-01',
  paid_at: '2026-06-25',
  total_usd: 100,
  items: [{
    id: 1, container_number: 'TCLU1234567', container_type: '40GP',
    days_p1: 5, rate_p1_usd: 20, days_p2: 0, rate_p2_usd: 30,
    discharge_date: '2026-06-01', return_date: '2026-06-20', subtotal_usd: 100,
  }],
  customer: { name: 'Cliente Demurrage', cnpj_cpf: '11222333000181' },
  bl: { pol: 'CNSHA', pod: 'BRVIX', voyage: { voyage_number: '14N', vessel: { name: 'GREEN' } } },
} as unknown as DemurrageInvoiceDetail

afterEach(cleanup)

it('US-048: imprime a fatura de demurrage com numero, BL e cliente', () => {
  render(<InvoiceDocument detail={detail} type="invoice" />)

  expect(screen.getByText('FATURA DE SOBREESTADIA DE CONTAINER')).toBeTruthy()
  expect(screen.getByText('BL-9')).toBeTruthy()
  expect(screen.getByText(/Cliente Demurrage/)).toBeTruthy()
  expect(screen.getAllByText('TCLU1234567').length).toBeGreaterThan(0)
})

it('US-048: imprime o recibo de quitacao quando type=receipt', () => {
  render(<InvoiceDocument detail={detail} type="receipt" />)
  expect(screen.getByText('RECIBO DE QUITAÇÃO DE SOBREESTADIA')).toBeTruthy()
})
