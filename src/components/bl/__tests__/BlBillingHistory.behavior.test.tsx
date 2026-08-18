// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BlFaturamentoTab } from '../BlFaturamentoTab'
import { BlHistoricoTab } from '../BlHistoricoTab'
import type { BLDetail } from '../../../types/database'

const { fetchNextPage, useBlTimelineMock, useInvoiceLinksMock } = vi.hoisted(() => ({
  fetchNextPage: vi.fn(),
  useBlTimelineMock: vi.fn(),
  useInvoiceLinksMock: vi.fn(),
}))

vi.mock('../../../hooks/useBlTimeline', () => ({ useBlTimeline: useBlTimelineMock }))
vi.mock('../../../hooks/useBilling', () => ({ useInvoiceLinks: useInvoiceLinksMock }))
vi.mock('../BlClienteSection', () => ({ BlClienteSection: () => <div>Cliente</div> }))
vi.mock('../BlCobrancasTab', () => ({ BlCobrancasSection: () => <div>Cobrancas</div> }))
vi.mock('../BlDemurrageSection', () => ({ BlDemurrageSection: () => <div>Demurrage</div> }))

beforeEach(() => {
  fetchNextPage.mockReset()
  useInvoiceLinksMock.mockReturnValue({
    data: { 'BL-1': [{ id: 77, invoice_number: 'INV-077' }] },
  })
  useBlTimelineMock.mockReturnValue({
    data: {
      pages: [[{
        id: 1,
        family: 'edicao',
        entity_type: 'bl',
        field_name: 'shipper',
        old_value: 'A',
        new_value: 'B',
        changed_by: 'user-1',
        changed_at: '2026-06-23',
        justification: 'Correcao',
      }]],
    },
    fetchNextPage,
    hasNextPage: true,
    isFetchingNextPage: false,
  })
})

describe('faturamento e historico do B/L', () => {
  it('abre a invoice ativa pela URL esperada', () => {
    render(
      <MemoryRouter>
        <BlFaturamentoTab active bl={{ id: 'BL-1', financial_status: 'invoiced' } as BLDetail} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: /Fatura ativa: INV-077/i }).getAttribute('href'))
      .toBe('/taxas-locais?invoice=77')
  })

  it('renderiza eventos e carrega a proxima pagina', () => {
    render(<BlHistoricoTab active blId="BL-1" />)

    expect(screen.getByText(/Shipper/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }))
    expect(fetchNextPage).toHaveBeenCalledTimes(1)
  })
})
