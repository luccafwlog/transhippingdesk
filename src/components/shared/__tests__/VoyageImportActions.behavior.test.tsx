// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(() => Promise.resolve()),
  showToast: vi.fn(),
  parseBreakbulkManifestFile: vi.fn(),
  importBreakbulkManifest: vi.fn(() => Promise.resolve()),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../../services/supabase', () => ({ supabase: { from: vi.fn() } }))
vi.mock('../../../services/breakbulkImport', () => ({
  parseBreakbulkManifestFile: mocks.parseBreakbulkManifestFile,
  importBreakbulkManifest: mocks.importBreakbulkManifest,
}))

import { VoyageImportActions } from '../VoyageImportActions'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.invalidateQueries.mockResolvedValue(undefined)
  mocks.importBreakbulkManifest.mockResolvedValue(undefined)
})
afterEach(cleanup)

function renderActions() {
  render(
    <VoyageImportActions
      voyageId={7}
      voyageLabel="GREEN SANTOS / 14N"
      userId="user-1"
      types={['cntr', 'bb', 'granite', 'baplie']}
    />,
  )
}

it('US-223: renderiza as acoes de importacao rapida escopadas na viagem', () => {
  renderActions()

  expect(screen.getByRole('button', { name: /Manifesto CNTR/ })).toBeTruthy()
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
