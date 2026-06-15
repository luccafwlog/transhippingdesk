// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PortalOperationBL } from '../../services/portalOperation'

const rows: PortalOperationBL[] = [
  {
    bl_id: 'BL001',
    ce_mercante: '123456789012345',
    pol: 'CNSHA',
    pod: 'BRVIX',
    voyage_id: 10,
    voyage_number: '001W',
    vessel_name: 'NAVIO TESTE',
    container_count: 2,
    containers_in_demurrage: 1,
    containers_returned: 1,
    containers: [
      {
        id: 1,
        container_number: 'ABCD1234567',
        type: '40GP',
        discharge_date: '2026-06-01',
        return_date: '2026-06-20',
        usage_days: 19,
        free_time_days: 21,
        demurrage_days: 0,
        status: 'devolvido',
      },
      {
        id: 2,
        container_number: 'EFGH1234567',
        type: '20RF',
        discharge_date: '2026-06-01',
        return_date: null,
        usage_days: 25,
        free_time_days: 10,
        demurrage_days: 15,
        status: 'em_demurrage',
      },
    ],
  },
  {
    bl_id: 'BL002',
    ce_mercante: null,
    pol: 'CNSHA',
    pod: 'BRSSZ',
    voyage_id: 11,
    voyage_number: '002W',
    vessel_name: 'NAVIO SEM CONTAINER',
    container_count: 0,
    containers_in_demurrage: 0,
    containers_returned: 0,
    containers: [],
  },
]

vi.mock('../../hooks/usePortalOperation', () => ({
  usePortalOperationBls: () => ({ data: rows, isLoading: false, error: null }),
}))

import { PortalOperacao } from '../PortalOperacao'

afterEach(cleanup)

// jsdom nao aplica CSS, entao tanto a view desktop (hidden md:block) quanto a
// mobile (md:hidden) renderizam juntas. Escopamos as queries a tabela desktop.
function desktopView(container: HTMLElement): HTMLElement {
  return container.querySelector('.md\\:block') as HTMLElement
}

describe('PortalOperacao', () => {
  it('lista BLs com CE Mercante e abre containers com dias operacionais', async () => {
    const user = userEvent.setup()
    const { container } = render(<PortalOperacao />)
    const desktop = desktopView(container)

    expect(screen.getByRole('heading', { name: 'Operacao' })).toBeTruthy()
    expect(within(desktop).getByText('BL001')).toBeTruthy()
    expect(within(desktop).getByText('CE 123456789012345')).toBeTruthy()
    expect(within(desktop).getByText('NAVIO TESTE / 001W')).toBeTruthy()

    await user.click(within(desktop).getByRole('row', { name: /BL001/ }))

    const table = within(desktop).getByRole('table', { name: 'Containers do BL BL001' })
    expect(within(table).getByText('ABCD1234567')).toBeTruthy()
    expect(within(table).getByText('EFGH1234567')).toBeTruthy()
    expect(within(table).getByText('20/06/2026')).toBeTruthy()
    expect(within(table).getByText('Pendente')).toBeTruthy()
    expect(within(table).getByText('19')).toBeTruthy()
    expect(within(table).getByText('15')).toBeTruthy()
    expect(within(table).getByText('Em demurrage')).toBeTruthy()
  })

  it('mostra estado de BL sem containers vinculados', async () => {
    const user = userEvent.setup()
    const { container } = render(<PortalOperacao />)
    const desktop = desktopView(container)

    await user.click(within(desktop).getByRole('row', { name: /BL002/ }))

    expect(within(desktop).getByText('Nenhum container vinculado a este B/L.')).toBeTruthy()
  })
})
