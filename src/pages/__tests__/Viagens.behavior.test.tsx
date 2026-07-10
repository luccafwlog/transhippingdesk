// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))
vi.mock('../../hooks/useBls', () => ({
  useVoyages: () => ({
    data: [{
      id: 42,
      voyage_number: 'CANCEL-42',
      status: 'cancelled',
      vessel: { name: 'Navio cancelado', carrier: null },
      pol: null,
      pod: null,
      bls: [],
    }],
    isLoading: false,
    error: null,
  }),
}))
vi.mock('../../hooks/useVehicles', () => ({ useVoyageVehicleStats: () => ({ data: { byVoyageId: {} } }) }))
vi.mock('../../hooks/useVaziosImportacaoStats', () => ({ useVaziosImportacaoStats: () => ({ data: { byVoyageId: {} } }) }))
vi.mock('../../hooks/useViagemSchedulesAndStats', () => ({
  useViagemSchedulesAndStats: () => ({
    voyagesWithUnpaidBls: [],
    polSchedules: new Map(),
    podSchedules: new Map(),
    podSchedulesByVoyage: new Map(),
    exportSchedulesData: new Map(),
  }),
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false, user: null }) }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../services/supabase', () => ({ supabase: { from: vi.fn() } }))

import { Viagens } from '../Viagens'

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/viagens" element={<Viagens />} />
        <Route path="/viagens/:voyageId" element={<Viagens />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(cleanup)

it('filtra o rail por viagens canceladas', () => {
  renderAt('/viagens')

  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'cancelled' } })

  expect(screen.getByText('Navio cancelado / CANCEL-42')).toBeTruthy()
})

it('US-213: sem selecao mostra "Selecione uma viagem"', () => {
  renderAt('/viagens')
  expect(screen.getByText('Selecione uma viagem')).toBeTruthy()
})

it('US-213: ID inexistente mantem a tela e mostra "Viagem não encontrada"', () => {
  renderAt('/viagens/999')
  expect(screen.getByText('Viagem não encontrada')).toBeTruthy()
})
