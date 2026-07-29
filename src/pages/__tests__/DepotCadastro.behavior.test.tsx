// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

const { mocks, depot, service } = vi.hoisted(() => ({
  mocks: { upsertDepotService: vi.fn(async () => {}), upsertDepot: vi.fn(async () => {}), deleteDepot: vi.fn(async () => {}), deleteDepotService: vi.fn(async () => {}), confirm: vi.fn(async () => true), showToast: vi.fn() },
  depot: { id: 'd1', code: 'VBR', name: 'Vila Velha', tipo: 'depot', free_time_vazio_days: 3, free_time_material_days: 2, active: true },
  service: { id: 's1', depot_id: 'd1', name: 'Handling', natureza: 'geral', container_type: null, route_destino_id: null, condition: null, rate_brl: 100, active: true, created_at: '2026-01-01' },
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ can: () => true }) }))
vi.mock('../../hooks/useDepots', () => ({ useDepots: () => ({ data: [depot], error: null, refetch: vi.fn(async () => {}) }) }))
vi.mock('../../services/depots', () => ({ listDepotServices: vi.fn(async () => [service]), upsertDepot: mocks.upsertDepot, upsertDepotService: mocks.upsertDepotService, deleteDepot: mocks.deleteDepot, deleteDepotService: mocks.deleteDepotService }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
import { DepotCadastro } from '../DepotCadastro'
function renderPage() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><DepotCadastro /></MemoryRouter></QueryClientProvider>) }
describe('Cadastro de Depot', () => {
  beforeEach(() => { cleanup(); for (const fn of Object.values(mocks)) (fn as { mockClear: () => void }).mockClear() })
  it('apresenta o novo modelo de Terminais e catálogo sugerido', () => { renderPage(); expect(screen.getByRole('heading', { name: 'Cadastro de Terminais' })).toBeTruthy(); expect(screen.getByText(/valores sugeridos/i)).toBeTruthy() })
  it('editar um serviço e salvar atualiza (não duplica)', async () => { renderPage(); fireEvent.click(await screen.findByRole('button', { name: /editar/i })); fireEvent.click(screen.getByRole('button', { name: /salvar serviço/i })); await waitFor(() => expect(mocks.upsertDepotService).toHaveBeenCalled()); expect((mocks.upsertDepotService.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0]).toMatchObject({ id: 's1', depot_id: 'd1' }) })
  it('carrega o formulário do local selecionado por padrão', async () => { renderPage(); await waitFor(() => expect((screen.getAllByLabelText('Código')[0] as HTMLInputElement).value).toBe('VBR')); expect((screen.getByLabelText('Free time vazio') as HTMLInputElement).value).toBe('3'); expect((screen.getByLabelText('Free time material') as HTMLInputElement).value).toBe('2') })
  it('pede confirmação antes de excluir um local', async () => { renderPage(); fireEvent.click(await screen.findByRole('button', { name: /excluir/i })); await waitFor(() => expect(mocks.confirm).toHaveBeenCalled()); expect(mocks.deleteDepot).toHaveBeenCalledWith('d1') })
  it('não exclui quando a confirmação é negada', async () => { mocks.confirm.mockResolvedValueOnce(false); renderPage(); fireEvent.click(await screen.findByRole('button', { name: /excluir/i })); await waitFor(() => expect(mocks.confirm).toHaveBeenCalled()); expect(mocks.deleteDepot).not.toHaveBeenCalled() })
  it('mostra toast de erro quando o salvamento falha', async () => { mocks.upsertDepot.mockRejectedValueOnce(new Error('sem permissão')); renderPage(); fireEvent.click(await screen.findByRole('button', { name: /salvar local/i })); await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('sem permissão', 'error')) })
})
