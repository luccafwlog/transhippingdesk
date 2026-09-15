// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DemurrageContainersTab } from '../DemurrageContainersTab'
import type { DemurrageContainerListItem } from '../../../types/database'

vi.mock('../../../services/demurrage/demurragePresentation', () => ({
  effectiveDemurrage: (container: DemurrageContainerListItem) => ({
    total_days: 40,
    free_days: 10,
    days_p1: 20,
    rate_p1_usd: 10,
    days_p2: 10,
    rate_p2_usd: 20,
    total_usd: container.demurrage_status === 'overdue' ? 400 : 0,
    status: container.demurrage_status,
  }),
  fmtUSD: (val: number | null | undefined) => (val == null ? '—' : `USD ${val}`),
}))

afterEach(cleanup)

function makeContainer(blId: string, id: number, overdue: boolean): DemurrageContainerListItem {
  return {
    id,
    bl_id: blId,
    container_number: `MSCU${id}00000`,
    type: '40HC',
    discharge_date: '2026-06-01',
    return_date: null,
    demurrage_status: overdue ? 'overdue' : 'in_progress',
    bl: {
      id: blId,
      customer_id: 1,
      customer: { name: `Cliente ${blId}` },
      voyage: {
        voyage_number: '001E',
        vessel: { name: 'Navio Teste' },
      },
    },
  } as unknown as DemurrageContainerListItem
}

describe('DemurrageContainersTab - Concorrência e Emissão de Fatura', () => {
  const container1 = makeContainer('BL-001', 1, true)
  const container2 = makeContainer('BL-002', 2, true)

  const grouped = new Map<string, DemurrageContainerListItem[]>([
    ['BL-001', [container1]],
    ['BL-002', [container2]],
  ])

  it('permite clicar em Gerar Fatura quando nenhuma fatura estiver sendo gerada', async () => {
    const user = userEvent.setup()
    const onGenerateInvoice = vi.fn()

    render(
      <MemoryRouter>
        <DemurrageContainersTab
          search=""
          filtered={[container1, container2]}
          grouped={grouped}
          filterDescription="2 containers em demurrage"
          loading={false}
          error={null}
          generatingBl={null}
          onSearchChange={vi.fn()}
          onGenerateInvoice={onGenerateInvoice}
          onEditContainer={vi.fn()}
        />
      </MemoryRouter>,
    )

    const buttons = screen.getAllByRole('button', { name: /Gerar Fatura/i }) as HTMLButtonElement[]
    expect(buttons).toHaveLength(2)
    expect(buttons[0].disabled).toBe(false)
    expect(buttons[1].disabled).toBe(false)

    await user.click(buttons[0])
    expect(onGenerateInvoice).toHaveBeenCalledWith('BL-001')
  })

  it('desabilita todos os botões de emissão quando um B/L específico está em processamento', () => {
    render(
      <MemoryRouter>
        <DemurrageContainersTab
          search=""
          filtered={[container1, container2]}
          grouped={grouped}
          filterDescription="2 containers em demurrage"
          loading={false}
          error={null}
          generatingBl="BL-001"
          onSearchChange={vi.fn()}
          onGenerateInvoice={vi.fn()}
          onEditContainer={vi.fn()}
        />
      </MemoryRouter>,
    )

    // O botão do BL-001 mostra 'Gerando...' e está desabilitado
    const generatingButton = screen.getByRole('button', { name: /Gerando\.\.\./i }) as HTMLButtonElement
    expect(generatingButton.disabled).toBe(true)

    // O botão do BL-002 ainda mostra 'Gerar Fatura', mas também está desabilitado contra concorrência
    const otherButton = screen.getByRole('button', { name: /Gerar Fatura/i }) as HTMLButtonElement
    expect(otherButton.disabled).toBe(true)
  })
})
