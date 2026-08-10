// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { Manifestos } from '../Manifestos'

const { useBlsMock } = vi.hoisted(() => ({ useBlsMock: vi.fn() }))

vi.mock('../../hooks/useBls', () => ({
  useBls: useBlsMock,
  useBlSummary: () => ({ data: {}, isLoading: false }),
  usePortOptions: () => ({ data: { pols: [], pods: [] } }),
  useVoyageOptions: () => ({ data: [] }),
  fetchAllBls: vi.fn(),
}))
vi.mock('../../hooks/useBilling', () => ({ useInvoiceLinks: () => ({ data: {} }) }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: true, user: { id: 'user-1' } }) }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn() }))
vi.mock('../../components/shared/CeMercanteImportModal', () => ({ CeMercanteImportModal: () => null }))
vi.mock('../../components/shared/VoyageCreateModal', () => ({ VoyageCreateModal: () => null }))
vi.mock('../../components/shared/BulkActionsBar', () => ({
  BulkActionsBar: ({ count }: { count: number }) => <div>Selecionados: {count}</div>,
}))

beforeEach(() => {
  useBlsMock.mockReset()
  useBlsMock.mockImplementation(() => ({
    data: {
      rows: [{
        id: 'BL-001',
        ce_mercante: null,
        consignee: 'Cliente',
        pol: 'SHA',
        pod: 'SSZ',
        charge_status: 'review_required',
        bl_containers: [],
        voyage: { voyage_number: 'V001', vessel: { name: 'Navio' } },
      }],
      count: 40,
    },
    isLoading: false,
    error: null,
  }))
})

it('filtra, pagina, seleciona e abre um B/L', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Manifestos />
      </MemoryRouter>
    </QueryClientProvider>,
  )

  const openLink = screen.getByRole('link', { name: 'Abrir B/L' })
  expect(openLink.getAttribute('href')).toBe('/manifestos/BL-001')

  fireEvent.click(screen.getByRole('button', { name: 'Filtros' }))
  fireEvent.change(screen.getByPlaceholderText('B/L ou cliente'), { target: { value: 'BL-001' } })
  expect(useBlsMock.mock.calls.at(-1)?.[0]).toMatchObject({ search: 'BL-001', page: 1 })

  fireEvent.click(screen.getByLabelText('Selecionar B/L BL-001'))
  expect(screen.getByText('Selecionados: 1')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Próxima' }))
  expect(useBlsMock.mock.calls.at(-1)?.[0]).toMatchObject({ page: 2 })
})

it('nao oferece importacao de Manifesto CNTR nem geracao de EDI Mercante', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Manifestos />
      </MemoryRouter>
    </QueryClientProvider>,
  )

  expect(screen.queryAllByRole('button', { name: 'Importar Manifesto CNTR' })).toHaveLength(0)
  expect(screen.queryAllByRole('button', { name: 'Gerar EDI Mercante' })).toHaveLength(0)
})

it('aplica o POL recebido na URL junto com viagem e POD', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/manifestos?voyage=7&pol=CNTAC&pod=BRVIX']}>
        <Manifestos />
      </MemoryRouter>
    </QueryClientProvider>,
  )

  expect(useBlsMock.mock.calls.at(-1)?.[0]).toMatchObject({ voyageId: '7', pol: 'CNTAC', pod: 'BRVIX' })
})
