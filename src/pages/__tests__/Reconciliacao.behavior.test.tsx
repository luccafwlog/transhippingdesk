// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  match: vi.fn(),
  createImportKey: vi.fn(),
  persist: vi.fn(),
  listExceptions: vi.fn(),
  resolveException: vi.fn(),
  confirm: vi.fn(),
  reverseDemurrage: vi.fn(),
  getDemurrageDetail: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('../../services/demurrage/demurrageKpis', () => ({
  parsePixExtractFile: mocks.parse,
}))
vi.mock('../../services/reconciliacao', () => ({
  matchUnifiedPixTransactions: mocks.match,
  createPixImportKey: mocks.createImportKey,
  persistUnresolvedPixMatches: mocks.persist,
  listPixReconciliationExceptions: mocks.listExceptions,
  resolvePixReconciliationException: mocks.resolveException,
  confirmUnifiedPixReconciliation: mocks.confirm,
  reverseDemurragePayment: mocks.reverseDemurrage,
}))
vi.mock('../../services/demurrage/demurrageInvoices', () => ({
  getInvoiceDetail: mocks.getDemurrageDetail,
}))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ isAdmin: true }),
}))
vi.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))
vi.mock('../../components/billing/InvoiceDetailModal', () => ({
  InvoiceDetailModal: ({ invoiceId, paymentId }: { invoiceId: number | null; paymentId: number | null }) =>
    invoiceId ? <div>Detalhe local {invoiceId}/{paymentId}<button>Imprimir recibo</button></div> : null,
}))
vi.mock('../../components/billing/ReconciliationHistoryTable', () => ({
  ReconciliationHistoryTable: ({
    onSelectLocalInvoice,
    onSelectDemurrageInvoice,
  }: {
    onSelectLocalInvoice: (invoiceId: number, paymentId: number) => void
    onSelectDemurrageInvoice: (invoiceId: number) => void
  }) => (
    <div>
      <button onClick={() => onSelectLocalInvoice(11, 21)}>Abrir local</button>
      <button onClick={() => onSelectDemurrageInvoice(31)}>Abrir demurrage</button>
    </div>
  ),
}))
vi.mock('../../components/demurrage/InvoiceDocument', () => ({
  InvoiceDocument: () => <div>Recibo demurrage</div>,
}))

import { Reconciliacao } from '../Reconciliacao'

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  render(
    <QueryClientProvider client={queryClient}>
      <Reconciliacao />
    </QueryClientProvider>,
  )
  return { invalidate }
}

const transaction = { txid: 'INV-001', cnpj: '123', date: '2026-06-23', amount: 100 }
const safeMatch = {
  transaction,
  source: 'local' as const,
  invoiceId: 11,
  docNumber: 'INV-001',
  customerName: 'Cliente',
  customerCnpj: '123',
  amount: 100,
  ambiguous: false,
  matchType: 'txid' as const,
}
const ambiguousMatch = {
  ...safeMatch,
  invoiceId: 12,
  docNumber: 'INV-002',
  ambiguous: true,
  ambiguityReason: 'Valor divergente',
}
const unmatchedMatch = {
  ...safeMatch,
  source: 'unmatched' as const,
  invoiceId: 0,
  docNumber: 'SEM-MATCH',
  ambiguous: true,
  ambiguityReason: 'Nenhum documento aberto usa este TXID.',
  candidateCount: 0,
  matchType: 'unmatched' as const,
  transaction: { ...transaction, txid: 'SEM-MATCH' },
}

describe('Reconciliacao PIX user behaviours', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.parse.mockResolvedValue([transaction])
    mocks.match.mockResolvedValue([safeMatch, ambiguousMatch, unmatchedMatch])
    mocks.createImportKey.mockResolvedValue('sha256:pix-import')
    mocks.persist.mockResolvedValue([
      { id: 42, lineNumber: 1, status: 'active' },
      { id: 43, lineNumber: 2, status: 'active' },
    ])
    mocks.listExceptions.mockResolvedValue([])
    mocks.resolveException.mockResolvedValue({ id: 42, status: 'resolved' })
    mocks.confirm.mockResolvedValue({
      local: 1,
      demurrage: 0,
      items: [{ source: 'local', invoice_id: 11, doc_number: 'INV-001', status: 'ok' }],
    })
    mocks.reverseDemurrage.mockResolvedValue(undefined)
    mocks.getDemurrageDetail.mockResolvedValue({
      invoice: { id: 31, doc_number: 'DEM-31', status: 'paid', paid_at: '2026-06-25' },
      items: [],
    })
  })

  it('processa o arquivo e separa seguros, ambiguos e sem candidato', async () => {
    const user = userEvent.setup()
    renderPage()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    await user.upload(input, new File(['xlsx'], 'pix.xlsx', { type: 'application/vnd.ms-excel' }))

    expect(await screen.findByText('Sem documento candidato (1)')).toBeTruthy()
    expect(mocks.persist).toHaveBeenCalledWith('sha256:pix-import', [safeMatch, ambiguousMatch, unmatchedMatch])
    expect(screen.getByText('Correspondencias confirmadas (1)')).toBeTruthy()
    expect(screen.getByText('Ambiguas - ignoradas na confirmacao (1)')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Confirmar 1 pagamento(s)' })).toBeTruthy()
  })

  it('recarrega pendencias PIX persistidas e oferece nova tentativa segura', async () => {
    mocks.listExceptions.mockResolvedValueOnce([{
      id: 42,
      importKey: 'sha256:pix-import',
      lineNumber: 8,
      txid: '',
      cnpj: '123',
      paidAt: '2026-06-23',
      amount: 100,
      reason: 'unmatched',
      candidateCount: 0,
      metadata: {},
      status: 'active',
      createdAt: '2026-06-23T10:00:00Z',
      updatedAt: '2026-06-23T10:00:00Z',
      resolvedAt: null,
    }])
    renderPage()

    expect(await screen.findByText('Pendencias PIX persistidas (1)')).toBeTruthy()
    expect(screen.getByText(/Linha 8 · TXID ausente/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tentar conciliar' })).toBeTruthy()
  })

  it('confirma somente o match seguro, exibe o resultado e invalida consumidores', async () => {
    const user = userEvent.setup()
    const { invalidate } = renderPage()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, new File(['xlsx'], 'pix.xlsx', { type: 'application/vnd.ms-excel' }))

    await user.click(await screen.findByRole('button', { name: 'Confirmar 1 pagamento(s)' }))

    expect(mocks.confirm).toHaveBeenCalledWith([safeMatch])
    expect(await screen.findByText('Pagamentos confirmados')).toBeTruthy()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['reconciliation-history'] })
  })

  it('abre os detalhes local e demurrage e exige justificativa para o estorno', async () => {
    const user = userEvent.setup()
    const { invalidate } = renderPage()

    await user.click(screen.getByRole('button', { name: 'Abrir local' }))
    expect(screen.getByText('Detalhe local 11/21')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Imprimir recibo' }).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Abrir demurrage' }))
    expect(await screen.findByText('Recibo demurrage')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Imprimir recibo' }).length).toBeGreaterThan(0)
    const reverseButton = screen.getByRole('button', { name: 'Cancelar baixa' })
    expect((reverseButton as HTMLButtonElement).disabled).toBe(true)

    await user.type(screen.getByLabelText(/Justificativa para cancelar a baixa/), 'Pagamento duplicado')
    await user.click(reverseButton)

    await waitFor(() => expect(mocks.reverseDemurrage).toHaveBeenCalledWith(31, 'Pagamento duplicado'))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['reconciliation-history'] })
  })
})
