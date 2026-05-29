import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { TaxasLocais } from '../TaxasLocais'

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ can: () => true, user: { id: 'user-1' } }),
}))

vi.mock('../../components/ui/Toast', async () => {
  const actual = await vi.importActual<typeof import('../../components/ui/Toast')>('../../components/ui/Toast')
  return {
    ...actual,
    useToast: () => ({ showToast: vi.fn() }),
  }
})

vi.mock('../../components/ui/ConfirmDialog', async () => {
  const actual = await vi.importActual<typeof import('../../components/ui/ConfirmDialog')>('../../components/ui/ConfirmDialog')
  return {
    ...actual,
    useConfirm: () => vi.fn(async () => true),
  }
})

vi.mock('../../hooks/useLocalCharges', () => ({
  useLocalChargeOperations: () => ({
    data: [
      {
        id: 'BL-BB-001',
        cargo_mode: 'carga_solta',
        pod: 'BRVIX',
        charge_status: 'review_required',
        customer_reconciliation_status: 'matched_document',
        billing_hold_reason: null,
        charges_calculated_at: '2026-05-28T10:00:00Z',
        created_at: '2026-05-28T09:00:00Z',
        voyage: { id: 1, voyage_number: 'V001', vessel: { name: 'NAVIO TESTE' } },
        customer: { id: 10, name: 'Cliente Teste', cnpj_cpf: '123' },
        totals: { total_brl: 0, total_usd: 0, line_count: 1, review_required_count: 1 },
        trail: {
          last_event_at: '2026-05-28T10:01:00Z',
          last_event_by: null,
          last_event_field: 'charge_status',
          last_event_message: 'Nao existe tabela ativa para POD/mode na data de referencia',
        },
      },
    ],
    isLoading: false,
    error: null,
  }),
  useLocalChargeTables: () => ({ data: [], isLoading: false, error: null }),
  useCustomerRateOverrides: () => ({ data: [], isLoading: false, error: null }),
  useOverrideChargeItems: () => ({ data: [] }),
  useOverrideCustomers: () => ({ data: [] }),
  useSaveCustomerRateOverride: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteCustomerRateOverride: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSaveChargeTable: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetChargeTableActive: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSaveChargeTableItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteChargeTableItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBatchCalculateLocalCharges: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

describe('TaxasLocais', () => {
  it('mantem somente cadastro de tabelas e overrides, sem fila operacional de pendencias', () => {
    const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(TaxasLocais)))

    expect(html).toContain('Tabelas')
    expect(html).toContain('Overrides')
    expect(html).not.toContain('Pendencias de calculo')
    expect(html).not.toContain('Recalcular pendencias')
  })
})
