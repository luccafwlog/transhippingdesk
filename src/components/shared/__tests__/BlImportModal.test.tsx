// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(() => Promise.resolve()),
  showToast: vi.fn(),
  parseBLFile: vi.fn(),
  previewBlFreightImport: vi.fn(),
  confirmBlFreightImport: vi.fn(() => Promise.resolve({ imported: 1 })),
  applyLadenOnBoardAtd: vi.fn(() => Promise.resolve()),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../../services/blParser', () => ({ parseBLFile: mocks.parseBLFile }))
vi.mock('../../../services/blFreightImport', () => ({
  previewBlFreightImport: mocks.previewBlFreightImport,
  confirmBlFreightImport: mocks.confirmBlFreightImport,
}))
vi.mock('../../../services/ladenOnBoardAtd', () => ({
  applyLadenOnBoardAtd: mocks.applyLadenOnBoardAtd,
}))
vi.mock('../VoyageCombobox', () => ({
  VoyageCombobox: ({
    initialValue,
    onSelect,
  }: {
    initialValue?: string
    onSelect: (voyageId: number | null) => void
  }) => (
    <div>
      <span data-testid="voyage-initial">{initialValue ?? ''}</span>
      <button type="button" onClick={() => onSelect(7)}>Escolher viagem</button>
      <button type="button" onClick={() => onSelect(null)}>Limpar viagem</button>
    </div>
  ),
}))

import { BlImportModal } from '../BlImportModal'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.invalidateQueries.mockResolvedValue(undefined)
  mocks.confirmBlFreightImport.mockResolvedValue({ imported: 1 })
  mocks.applyLadenOnBoardAtd.mockResolvedValue(undefined)
})
afterEach(cleanup)

function renderModal(props: Partial<React.ComponentProps<typeof BlImportModal>> = {}) {
  const onClose = vi.fn()
  const view = render(
    <BlImportModal
      open
      onClose={onClose}
      {...props}
    />,
  )
  return { ...view, onClose }
}

function parsedDoc(blNumber: string) {
  return {
    blNumber,
    parties: {
      shipperBlock: 'SHIPPER',
      consigneeBlock: 'CONSIGNEE',
      consigneeTaxId: '12345678000199',
      notifyBlock: '',
      alsoNotifyBlock: '',
    },
    route: {
      receipt: '',
      pol: 'CNSHA',
      pod: 'BRSSZ',
      delivery: '',
      vessel: 'GREEN',
      voyage: '14N',
      movementFrom: '',
      movementTo: '',
    },
    dates: { ladenOnBoard: '', issueDate: '', issuePlace: '' },
    containers: [],
    vehicles: [],
    freightCharges: [],
  }
}

const previewWithDiff = {
  rows: [
    {
      blNumber: 'COSU123',
      status: 'new',
      existing: false,
      voyageId: 7,
      ladenOnBoard: '2026-02-19',
      consigneeDocumentMatches: null,
      blockedReasons: [],
      billingImpacts: [],
      requiresBillingOverride: false,
      diffs: [],
      payload: { id: 'COSU123' },
    },
    {
      blNumber: 'COSU456',
      status: 'updated',
      existing: true,
      voyageId: 7,
      ladenOnBoard: '2026-02-20',
      consigneeDocumentMatches: true,
      blockedReasons: [],
      billingImpacts: [],
      requiresBillingOverride: false,
      diffs: [{ field: 'bl_freight_lines', from: 'USD 10', to: 'USD 12', billingImpact: false }],
      payload: { id: 'COSU456' },
    },
  ],
  summary: {
    total: 2,
    newCount: 1,
    updatedCount: 1,
    unchangedCount: 0,
    blockedCount: 0,
    billingOverrideCount: 0,
  },
}

it('mostra preview consolidado e tabela de diferencas depois do upload', async () => {
  mocks.parseBLFile
    .mockResolvedValueOnce(parsedDoc('COSU123'))
    .mockResolvedValueOnce(parsedDoc('COSU456'))
  mocks.previewBlFreightImport.mockResolvedValue(previewWithDiff)

  const { container } = renderModal({ voyageId: 7, voyageLabel: 'GREEN / 14N' })

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: {
      files: [
        new File(['a'], 'bl-1.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        new File(['b'], 'bl-2.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      ],
    },
  })

  await waitFor(() => expect(mocks.previewBlFreightImport).toHaveBeenCalledWith({
    documents: [expect.objectContaining({ blNumber: 'COSU123' }), expect.objectContaining({ blNumber: 'COSU456' })],
    voyageId: 7,
    onlyBlId: null,
  }))

  expect(screen.getByText('GREEN / 14N')).toBeTruthy()
  expect(screen.getByText('COSU123')).toBeTruthy()
  expect(screen.getByText('COSU456')).toBeTruthy()
  expect(screen.getByText('2026-02-19')).toBeTruthy()
  expect(screen.getByText('2026-02-20')).toBeTruthy()
  expect(screen.getByText('bl_freight_lines')).toBeTruthy()
  expect(screen.getByText('USD 10')).toBeTruthy()
  expect(screen.getByText('USD 12')).toBeTruthy()
})

it('bloqueia confirmacao quando todos os B/Ls estao bloqueados', async () => {
  mocks.parseBLFile.mockResolvedValue(parsedDoc('COSU999'))
  mocks.previewBlFreightImport.mockResolvedValue({
    rows: [{
      blNumber: 'COSU999',
      status: 'blocked',
      existing: true,
      voyageId: null,
      ladenOnBoard: null,
      consigneeDocumentMatches: null,
      blockedReasons: ['Viagem nao encontrada para criar o B/L.'],
      billingImpacts: [],
      requiresBillingOverride: false,
      diffs: [],
      payload: null,
    }],
    summary: { total: 1, newCount: 0, updatedCount: 0, unchangedCount: 0, blockedCount: 1, billingOverrideCount: 0 },
  })

  const { container } = renderModal({ voyageId: 7, voyageLabel: 'GREEN / 14N' })

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'blocked.xlsx')] },
  })

  await screen.findByText('Viagem nao encontrada para criar o B/L.')

  expect((screen.getByRole('button', { name: /Confirmar importacao/ }) as HTMLButtonElement).disabled).toBe(true)
})

it('mantem confirmacao e preview travados enquanto nenhuma viagem foi escolhida', async () => {
  mocks.parseBLFile.mockResolvedValue(parsedDoc('COSU123'))

  const { container } = renderModal()

  expect((screen.getByRole('button', { name: /Confirmar importacao/ }) as HTMLButtonElement).disabled).toBe(true)

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'bl.xlsx')] },
  })

  await waitFor(() => expect(mocks.previewBlFreightImport).not.toHaveBeenCalled())
  expect(mocks.showToast).toHaveBeenCalledWith('Selecione a viagem antes de carregar o preview do B/L.', 'error')
})

it('usa o voyageId escolhido pelo operador ao preparar o preview', async () => {
  mocks.parseBLFile.mockResolvedValue(parsedDoc('COSU123'))
  mocks.previewBlFreightImport.mockResolvedValue(previewWithDiff)
  const { container } = renderModal()

  fireEvent.click(screen.getByRole('button', { name: 'Escolher viagem' }))
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'bl.xlsx')] },
  })

  await waitFor(() => expect(mocks.previewBlFreightImport).toHaveBeenCalledWith({
    documents: [expect.objectContaining({ blNumber: 'COSU123' })],
    voyageId: 7,
    onlyBlId: null,
  }))
})

it('confirma importacao, invalida caches e fecha modal', async () => {
  mocks.parseBLFile.mockResolvedValue(parsedDoc('COSU123'))
  mocks.previewBlFreightImport.mockResolvedValue(previewWithDiff)
  const { container, onClose } = renderModal({ voyageId: 7, voyageLabel: 'GREEN / 14N', onlyBlId: 'COSU123' })

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'bl.xlsx')] },
  })

  const confirm = await screen.findByRole('button', { name: /Confirmar importacao/ })
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(confirm)

  await waitFor(() => expect(mocks.confirmBlFreightImport).toHaveBeenCalledWith(previewWithDiff, 'user-1', false))
  expect(mocks.applyLadenOnBoardAtd).toHaveBeenCalledWith({ rows: previewWithDiff.rows, changedBy: 'user-1' })
  expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['bls'] })
  expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['bl-detail'] })
  expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['voyages'] })
  expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['voyage-pol-schedules'] })
  expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['voyage-timeline'] })
  expect(mocks.showToast).toHaveBeenCalledWith('Importacao de B/L concluida: 2 B/L(s), 0 bloqueado(s).', 'success')
  expect(onClose).toHaveBeenCalled()
})

it('avisa sobre falha do ATD sem mascarar importacao ja concluida', async () => {
  mocks.parseBLFile.mockResolvedValue(parsedDoc('COSU123'))
  mocks.previewBlFreightImport.mockResolvedValue(previewWithDiff)
  mocks.applyLadenOnBoardAtd.mockRejectedValueOnce(new Error('RLS bloqueou ATD'))
  const { container, onClose } = renderModal({ voyageId: 7, voyageLabel: 'GREEN / 14N' })

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'bl.xlsx')] },
  })

  const confirm = await screen.findByRole('button', { name: /Confirmar importacao/ })
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(confirm)

  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(mocks.showToast).toHaveBeenCalledWith(
    'B/Ls importados; ATD do POL não pôde ser atualizado — edite manualmente.',
    'info',
  )
  expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['bls'] })
  expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['voyage-pol-schedules'] })
  expect(mocks.showToast).toHaveBeenCalledWith('Importacao de B/L concluida: 2 B/L(s), 0 bloqueado(s).', 'success')
})

it('exibe impacto de faturamento e envia override quando o operador marca', async () => {
  const previewWithBillingImpact = {
    rows: [{
      blNumber: 'COSU777',
      status: 'updated',
      existing: true,
      voyageId: 7,
      ladenOnBoard: '2026-02-19',
      consigneeDocumentMatches: true,
      blockedReasons: [],
      billingImpacts: ['Quantidade de containers: 1 -> 2'],
      requiresBillingOverride: true,
      diffs: [{ field: 'containers', from: 'a', to: 'b', billingImpact: true }],
      payload: { id: 'COSU777' },
    }],
    summary: { total: 1, newCount: 0, updatedCount: 1, unchangedCount: 0, blockedCount: 0, billingOverrideCount: 1 },
  }
  mocks.parseBLFile.mockResolvedValue(parsedDoc('COSU777'))
  mocks.previewBlFreightImport.mockResolvedValue(previewWithBillingImpact)
  const { container } = renderModal({ voyageId: 7, voyageLabel: 'GREEN / 14N' })

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'bl.xlsx')] },
  })

  await screen.findByText('Faturamento: Quantidade de containers: 1 -> 2')
  const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement
  expect(checkbox).toBeTruthy()
  fireEvent.click(checkbox)

  const confirm = await screen.findByRole('button', { name: /Confirmar importacao/ })
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(confirm)

  await waitFor(() => expect(mocks.confirmBlFreightImport).toHaveBeenCalledWith(previewWithBillingImpact, 'user-1', true))
})
