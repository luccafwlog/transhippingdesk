// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockFailures = [
  {
    id: 1,
    alert_id: 10,
    alert_item_id: 20,
    event_id: 30,
    item_type: 'voyage_baplie_missing',
    department: 'documentacao',
    reason: 'Nenhum usuário ativo com papel documentacao encontrado',
    created_at: '2026-08-20T10:00:00Z',
    entity_type: 'voyage',
    entity_id: '99',
  },
]

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = queryKey[0] as string
    if (key === 'admin-users') return { data: [], isLoading: false, error: null }
    if (key === 'admin-routing-failures') {
      return { data: { rows: mockFailures, count: 1 }, isLoading: false, error: null }
    }
    if (key === 'admin-audit-logs') return { data: { rows: [], count: 0 }, isLoading: false, error: null }
    if (key === 'admin-metrics') return { data: null, isLoading: false, error: null }
    return { data: null, isLoading: false, error: null }
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn() }))
vi.mock('../../hooks/useAgencyReport', () => ({ useAgencyReportSla: () => ({ data: [], isLoading: false, error: null }) }))

import { AdminUsuarios } from '../AdminUsuarios'

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

describe('AdminUsuarios — Falhas de Roteamento e Audiência', () => {
  it('renderiza a aba de falhas de roteamento e lista as ocorrências', () => {
    render(
      <MemoryRouter>
        <AdminUsuarios />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Falhas de Roteamento' }))

    expect(screen.getByText('Tipo do Alerta')).toBeTruthy()
    expect(screen.getByText('Setor Esperado')).toBeTruthy()
    expect(screen.getByText('Baplie ausente')).toBeTruthy()
    expect(screen.getByText('Nenhum usuário ativo com papel documentacao encontrado')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Abrir Baplie/ })).toBeTruthy()
  })

  it('exibe a explicação clara dos papéis e audiência do catálogo na aba de usuários', () => {
    render(
      <MemoryRouter>
        <AdminUsuarios />
      </MemoryRouter>,
    )

    expect(screen.getByText('Audiência de Alertas e Notificações')).toBeTruthy()
    expect(screen.getByText(/Os papéis que recebem Notificações Internas diretamente das regras ativas/)).toBeTruthy()
    expect(screen.getByText(/exclusivamente por/)).toBeTruthy()
  })
})
