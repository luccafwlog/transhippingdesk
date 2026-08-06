// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ValidacaoControls } from '../ValidacaoControls'

afterEach(cleanup)

function renderControls(overrides: Partial<React.ComponentProps<typeof ValidacaoControls>> = {}) {
  const callbacks = {
    onUpdateFilter: vi.fn(),
    onPipelineStep: vi.fn(),
    onRunBatchOperation: vi.fn(),
    onRecalculateAllInReview: vi.fn(),
    onExport: vi.fn(),
    onExportConference: vi.fn(),
  }
  const queryClient = new QueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <ValidacaoControls
        filters={{ search: '', cargoMode: '', pod: '', voyageId: '', chargeStatus: '' }}
        selectedCount={0}
        operationsLoading={false}
        provisional={0}
        awaitingCe={0}
        reconciliationPending={0}
        reviewPending={0}
        ready={0}
        readyInvoiced={0}
        readyPendingInvoice={0}
        pipelineBottleneck={null}
        reconciliationFilter={false}
        reviewFilter={false}
        calculatePending={false}
        reviewPendingMutation={false}
        readyPendingMutation={false}
        exporting={false}
        exportingConference={false}
        {...callbacks}
        {...overrides}
      />
    </QueryClientProvider>,
  )
  return callbacks
}

// Etapa 12 do plano de faturamento: o botão "Recalcular todas em revisão"
// substitui a aba Pendências removida — só aparece quando o passo 2 do
// funil ("Em revisao") tem itens, e dispara o recalculo em massa sem
// exigir seleção manual.
describe('ValidacaoControls — recalcular todas em revisão', () => {
  it('não renderiza o botão quando não há B/Ls em revisão', () => {
    renderControls({ reviewPending: 0 })
    expect(screen.queryByText(/Recalcular todas em revisão/)).toBeNull()
  })

  it('renderiza o botão com a contagem e aciona o callback ao clicar', async () => {
    const user = userEvent.setup()
    const callbacks = renderControls({ reviewPending: 7 })

    const button = screen.getByText('Recalcular todas em revisão (7)')
    await user.click(button)

    expect(callbacks.onRecalculateAllInReview).toHaveBeenCalledTimes(1)
  })
})
