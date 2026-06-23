// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  showToast: vi.fn(),
  listAllUserProfiles: vi.fn(),
  updateUserProfile: vi.fn(),
  mutate: vi.fn(),
  confirm: vi.fn(),
  errorByKey: {} as Record<string, unknown>,
}))

const users = [
  { id: 'u-1', full_name: 'Alice Operadora', role: 'operacoes', active: true, created_at: '2026-01-02T00:00:00Z' },
  { id: 'u-2', full_name: 'Bruno Inativo', role: 'financeiro', active: false, created_at: '2026-01-03T00:00:00Z' },
]

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = queryKey[0] as string
    const error = mocks.errorByKey[key] ?? null
    if (key === 'admin-users') return { data: users, isLoading: false, error }
    return { data: undefined, isLoading: false, error }
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
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
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
  mocks.errorByKey = {}
  mocks.updateUserProfile.mockResolvedValue(undefined)
  mocks.confirm.mockResolvedValue(true)
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

it('US-147: alterna o status ativo de um usuario apos confirmar', async () => {
  render(<AdminUsuarios />)

  // Alice is active -> her action button reads "Desativar"
  fireEvent.click(screen.getAllByRole('button', { name: 'Desativar' })[0])

  // Pede confirmação antes de mutar (ação revoga acesso).
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
  await waitFor(() => expect(mocks.updateUserProfile).toHaveBeenCalledWith('u-1', { active: false }))
})

it('Task 9: cancelar a confirmacao nao desativa o usuario', async () => {
  mocks.confirm.mockResolvedValue(false)
  render(<AdminUsuarios />)

  fireEvent.click(screen.getAllByRole('button', { name: 'Desativar' })[0])

  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
  expect(mocks.updateUserProfile).not.toHaveBeenCalled()
})

it('US-147: altera o perfil de acesso de um usuario', () => {
  render(<AdminUsuarios />)

  const select = screen.getAllByRole('combobox')[0]
  fireEvent.change(select, { target: { value: 'financeiro' } })

  expect(mocks.updateUserProfile).toHaveBeenCalledWith('u-1', { role: 'financeiro' })
})

it('DEF-061: surface dedicada de erro ao carregar logs de acoes', () => {
  mocks.errorByKey = { 'admin-audit-logs': new Error('logs down') }
  render(<AdminUsuarios />)

  fireEvent.click(screen.getByRole('button', { name: 'Log de Ações' }))

  expect(screen.getByText('Erro ao carregar logs de ações.')).toBeTruthy()
})

it('DEF-062: surface dedicada de erro ao carregar metricas do sistema', () => {
  mocks.errorByKey = { 'admin-metrics': new Error('metrics down') }
  render(<AdminUsuarios />)

  fireEvent.click(screen.getByRole('button', { name: 'Métricas' }))

  expect(screen.getByText('Erro ao carregar métricas do sistema.')).toBeTruthy()
})
