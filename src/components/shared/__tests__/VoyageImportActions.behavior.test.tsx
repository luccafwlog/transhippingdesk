// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(() => Promise.resolve()),
  showToast: vi.fn(),
  parseBreakbulkManifestFile: vi.fn(),
  importBreakbulkManifest: vi.fn(() => Promise.resolve()),
  can: vi.fn<(permission: string) => boolean>(() => true),
  effectiveRole: vi.fn(() => 'documentacao'),
  profile: { id: 'user-1' },
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))
vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ can: mocks.can, effectiveRole: mocks.effectiveRole(), profile: mocks.profile }),
}))
vi.mock('../../../services/supabase', () => ({ supabase: { from: vi.fn() } }))
vi.mock('../../../services/breakbulkImport', () => ({
  parseBreakbulkManifestFile: mocks.parseBreakbulkManifestFile,
  importBreakbulkManifest: mocks.importBreakbulkManifest,
}))
vi.mock('../CeMercanteImportModal', () => ({
  CeMercanteImportModal: ({ lockedVoyageId, target }: { lockedVoyageId?: number; target?: string }) => <div>CE travado: {lockedVoyageId} · {target ?? 'bls'}</div>,
}))

import { VoyageImportActions } from '../VoyageImportActions'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.can.mockReturnValue(true)
  mocks.effectiveRole.mockReturnValue('documentacao')
  mocks.invalidateQueries.mockResolvedValue(undefined)
  mocks.importBreakbulkManifest.mockResolvedValue(undefined)
  mocks.navigate.mockReset()
})
afterEach(cleanup)

function renderActions() {
  render(
    <VoyageImportActions
      voyageId={7}
      voyageLabel="GREEN SANTOS / 14N"
      userId="user-1"
      types={['bb', 'granite', 'baplie']}
    />,
  )
}

it('US-223: renderiza as acoes de importacao rapida escopadas na viagem', () => {
  renderActions()

  expect(screen.queryByRole('button', { name: /Manifesto CNTR/ })).toBeNull()
  expect(screen.getByRole('button', { name: /Manifesto BB/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Manifesto Granito/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Baplie EDI/ })).toBeTruthy()
})

it('US-223: clicar numa acao abre o importador escopado na viagem', () => {
  renderActions()

  // Nenhum modal aberto antes do clique.
  expect(screen.queryByText('Importar Manifesto BB (Break Bulk)')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: /Manifesto BB/ }))

  // O modal abre exibindo o rótulo da viagem — prova de escopo.
  expect(screen.getByText('Importar Manifesto BB (Break Bulk)')).toBeTruthy()
  expect(screen.getByText('GREEN SANTOS / 14N')).toBeTruthy()
})

it('US-223: confirmar a importacao conecta o importador ao voyageId travado', async () => {
  mocks.parseBreakbulkManifestFile.mockResolvedValue({
    bls: [{ id: 'BL-1' }],
    rowErrors: [],
  })

  const { container } = render(
    <VoyageImportActions
      voyageId={7}
      voyageLabel="GREEN SANTOS / 14N"
      userId="user-1"
      types={['bb']}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: /Manifesto BB/ }))

  const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(['conteudo'], 'manifesto-bb.xlsx', { type: 'application/vnd.ms-excel' })
  fireEvent.change(fileInput, { target: { files: [file] } })

  // Aguarda o parser rodar e o botao Confirmar habilitar (prévia válida).
  await waitFor(() => expect(mocks.parseBreakbulkManifestFile).toHaveBeenCalledWith(file))
  const confirm = screen.getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement
  await waitFor(() => expect(confirm.disabled).toBe(false))

  fireEvent.click(confirm)

  await waitFor(() => {
    expect(mocks.importBreakbulkManifest).toHaveBeenCalledTimes(1)
  })
  expect(mocks.importBreakbulkManifest).toHaveBeenCalledWith(
    expect.objectContaining({ voyageId: 7, filename: 'manifesto-bb.xlsx', uploadedBy: 'user-1' }),
  )
})

it('ordena as importacoes e abre CE Mercante travado na viagem', () => {
  render(
    <VoyageImportActions
      voyageId={7}
      voyageLabel="GREEN SANTOS / 14N"
      userId="user-1"
      types={['vaziosImp', 'vehicles', 'bb', 'ceMercante', 'blFreight', 'blBreakbulk', 'baplie']}
    />,
  )

  expect(screen.getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
    'Baplie EDI', 'B/L container', 'B/L carga solta', 'CE Mercante', 'Manifesto BB', 'Veículos', 'Vazios IMP',
  ])
  fireEvent.click(screen.getByRole('button', { name: /CE Mercante/ }))
  expect(screen.getByText('CE travado: 7 · bls')).toBeTruthy()
})

it('separa a barra por família sem criar separador dentro dos B/Ls', () => {
  const { container } = render(
    <VoyageImportActions
      voyageId={7}
      voyageLabel="GREEN SANTOS / 14N"
      userId="user-1"
      types={['baplie', 'blFreight', 'blBreakbulk', 'ceMercante', 'vehicles', 'vaziosImp']}
    />,
  )

  expect(container.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(2)
})

it('leva Vazios Exp ao Embarque com a viagem travada', () => {
  render(
    <VoyageImportActions
      voyageId={7}
      voyageLabel="GREEN SANTOS / 14N"
      userId="user-1"
      types={['vaziosExp']}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Novo embarque de vazios' }))
  expect(mocks.navigate).toHaveBeenCalledWith('/embarquevazios?voyage=7')
})

it('abre CE Mercante do Granito com o alvo correto e a viagem travada', () => {
  render(
    <VoyageImportActions
      voyageId={7}
      voyageLabel="GREEN SANTOS / 14N"
      userId="user-1"
      types={['ceMercanteGranite']}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'CE Mercante (Granito)' }))
  expect(screen.getByText('CE travado: 7 · granite')).toBeTruthy()
})

it('mantém a escrita aberta também para Equipamentos', () => {
  mocks.effectiveRole.mockReturnValue('equipamentos')

  render(
    <VoyageImportActions
      voyageId={7}
      voyageLabel="GREEN SANTOS / 14N"
      userId="user-1"
      types={['bb', 'granite', 'vaziosImp', 'vaziosExp', 'vehicles', 'baplie', 'blFreight', 'blBreakbulk', 'ceMercante']}
    />,
  )

  expect(screen.getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
    'Baplie EDI', 'B/L container', 'B/L carga solta', 'CE Mercante', 'Manifesto BB', 'Veículos', 'Vazios IMP', 'Manifesto Granito', 'Novo embarque de vazios',
  ])
})

it('preserva todas as importacoes solicitadas para os demais papeis', () => {
  mocks.effectiveRole.mockReturnValue('documentacao')
  mocks.can.mockReturnValue(true)

  render(
    <VoyageImportActions
      voyageId={7}
      voyageLabel="GREEN SANTOS / 14N"
      userId="user-1"
      types={['bb', 'granite', 'vaziosImp', 'vaziosExp', 'vehicles', 'baplie', 'blFreight', 'blBreakbulk', 'ceMercante']}
    />,
  )

  expect(screen.getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
    'Baplie EDI', 'B/L container', 'B/L carga solta', 'CE Mercante', 'Manifesto BB', 'Veículos', 'Vazios IMP', 'Manifesto Granito', 'Novo embarque de vazios',
  ])
})
