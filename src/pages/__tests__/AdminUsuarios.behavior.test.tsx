// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  showToast: vi.fn(),
  listAllUserProfiles: vi.fn(),
  updateUserProfile: vi.fn(),
  mutate: vi.fn(),
}))

const users = [
  { id: 'u-1', full_name: 'Alice Operadora', role: 'operacoes', active: true, created_at: '2026-01-02T00:00:00Z' },
  { id: 'u-2', full_name: 'Bruno Inativo', role: 'financeiro', active: false, created_at: '2026-01-03T00:00:00Z' },
]

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    if (queryKey[0] === 'admin-users') return { data: users, isLoading: false, error: null }
    return { data: undefined, isLoading: false, error: null }
  },
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useMutation: (opts: { mutationFn: (vars: unknown) => unknown }) => ({
    mutate: (vars: unknown) => {
      mocks.mutate(vars)
      return opts.mutationFn(vars)
    },
    isPending: false,
  }),
}))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../services/supabase', () => ({ supabase: { from: vi.fn() } }))
vi.mock('../../services/adminUsers', async (importActual) => {
  const actual = await importActual<typeof import('../../services/adminUsers')>()
  return {
    ...actual,
    listAllUserProfiles: mocks.listAllUserProfiles,
    updateUserProfile: mocks.updateUserProfile,
  }
})

import { AdminUsuarios } from '../AdminUsuarios'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updateUserProfile.mockResolvedValue(undefined)
})
afterEach(cleanup)

it('US-146: lista os usuarios com nome, perfil e status', () => {
  render(<AdminUsuarios />)

  expect(screen.getByText('Alice Operadora')).toBeTruthy()
  expect(screen.getByText('Bruno Inativo')).toBeTruthy()
  // status badges
  expect(screen.getAllByText('Ativo').length).toBeGreaterThan(0)
  expect(screen.getAllByText('Inativo').length).toBeGreaterThan(0)
})

it('US-147: alterna o status ativo de um usuario', () => {
  render(<AdminUsuarios />)

  // Alice is active -> her action button reads "Desativar"
  fireEvent.click(screen.getAllByRole('button', { name: 'Desativar' })[0])

  expect(mocks.updateUserProfile).toHaveBeenCalledWith('u-1', { active: false })
})

it('US-147: altera o perfil de acesso de um usuario', () => {
  render(<AdminUsuarios />)

  const select = screen.getAllByRole('combobox')[0]
  fireEvent.change(select, { target: { value: 'financeiro' } })

  expect(mocks.updateUserProfile).toHaveBeenCalledWith('u-1', { role: 'financeiro' })
})
