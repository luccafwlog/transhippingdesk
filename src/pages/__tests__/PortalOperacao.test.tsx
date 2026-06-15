// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
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
  {
    bl_id: 'BL003',
    ce_mercante: '987654321098765',
    pol: 'CNSHA',
    pod: 'BRVIX',
    voyage_id: 12,
    voyage_number: '003W',
    vessel_name: 'NAVIO DEVOLVIDO',
    container_count: 2,
    containers_in_demurrage: 0,
    containers_returned: 2,
    containers: [
      {
        id: 3,
        container_number: 'IJKL1234567',
        type: '40GP',
        discharge_date: '2026-06-01',
        return_date: '2026-06-15',
        usage_days: 14,
        free_time_days: 21,
        demurrage_days: 0,
        status: 'devolvido',
      },
      {
        id: 4,
        container_number: 'MNOP1234567',
        type: '20GP',
        discharge_date: '2026-06-01',
        return_date: '2026-06-16',
        usage_days: 15,
        free_time_days: 21,
        demurrage_days: 0,
        status: 'devolvido',
      },
    ],
  },
]

vi.mock('../../hooks/usePortalOperation', () => ({
  usePortalOperationBls: () => ({ data: rows, isLoading: false, error: null }),
}))

import { PortalOperacao } from '../PortalOperacao'

afterEach(cleanup)

function renderOperacao(initialEntry = '/portal/operacao') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <PortalOperacao />
    </MemoryRouter>,
  )
}

describe('PortalOperacao (BLs e Containers)', () => {
  it('mostra as abas BLs e Containers e a coluna POL na aba BLs', () => {
    renderOperacao()
    expect(screen.getByRole('heading', { name: 'BLs e Containers' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'BLs' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Containers' })).toBeTruthy()

    const blsTable = screen.getByRole('table')
    expect(within(blsTable).getByRole('columnheader', { name: 'POL' })).toBeTruthy()
    // POL exibido na linha do B/L
    expect(within(blsTable).getAllByText('CNSHA').length).toBeGreaterThan(0)
  })

  it('filtra B/Ls por navio na aba BLs', async () => {
    const user = userEvent.setup()
    renderOperacao()

    await user.click(screen.getByRole('button', { name: /Filtros/i }))
    await user.type(screen.getByLabelText('Navio'), 'NAVIO TESTE')

    expect(screen.getByText('BL001')).toBeTruthy()
    expect(screen.queryByText('BL003')).toBeNull()
  })

  it('deriva a aba Containers dos containers dos B/Ls', async () => {
    const user = userEvent.setup()
    renderOperacao()

    await user.click(screen.getByRole('tab', { name: 'Containers' }))
    // Containers de todos os B/Ls aparecem sem precisar abrir o B/L
    expect(screen.getByText('ABCD1234567')).toBeTruthy()
    expect(screen.getByText('EFGH1234567')).toBeTruthy()
    expect(screen.getByText('IJKL1234567')).toBeTruthy()
  })

  it('abre a aba Containers filtrada por demurrage via query param', () => {
    renderOperacao('/portal/operacao?tab=containers&devolucao=em_demurrage')
    // Apenas EFGH (em demurrage, sem devolucao) deve aparecer
    expect(screen.getByText('EFGH1234567')).toBeTruthy()
    expect(screen.queryByText('ABCD1234567')).toBeNull()
    expect(screen.queryByText('IJKL1234567')).toBeNull()
  })
})
