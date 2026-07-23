// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ can: () => true }) }))
vi.mock('../../hooks/useDepots', () => ({ useDepots: () => ({ data: [], error: null, refetch: vi.fn() }) }))
vi.mock('../../services/depots', () => ({ listDepotServices: vi.fn(async () => []), upsertDepot: vi.fn(), upsertDepotService: vi.fn(), deleteDepotService: vi.fn() }))
import { DepotCadastro } from '../DepotCadastro'

describe('Cadastro de Depot', () => {
  it('apresenta o novo modelo de serviços precificados', () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><DepotCadastro /></MemoryRouter></QueryClientProvider>)
    expect(screen.getByRole('heading', { name: 'Tabela de Depots' })).toBeTruthy()
    expect(screen.getByText(/serviços precificados por tipo de cálculo/i)).toBeTruthy()
  })
})
