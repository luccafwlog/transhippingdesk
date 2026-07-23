// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ can: vi.fn(() => true), user: { id: 'u1' } }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../components/shared/VoyageCombobox', () => ({ VoyageCombobox: () => <div data-testid="voyage-combobox" /> }))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }), useQuery: ({ queryKey }: { queryKey: unknown[] }) => queryKey[0] === 'vazios-bookings' ? { data: { rows: [], count: 0 }, error: null } : { data: null, error: null } }))
vi.mock('../../hooks/useDepots', () => ({ useDepots: () => ({ data: [], error: null, refetch: vi.fn() }) }))
vi.mock('../../services/depots', () => ({ listDepots: vi.fn(async () => []), listCurrentDepotServices: vi.fn(async () => []), listDepotServices: vi.fn(async () => []), upsertDepot: vi.fn(), upsertDepotService: vi.fn(), deleteDepotService: vi.fn() }))

import { EmbarqueVazios } from '../EmbarqueVazios'

describe('Vazios EXP — novo modelo', () => {
  it('exibe acesso à Tabela de Depots e importação para quem tem permissão', () => {
    render(<MemoryRouter><EmbarqueVazios /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Tabela de Depots' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Importar' })).toBeTruthy()
  })
})
