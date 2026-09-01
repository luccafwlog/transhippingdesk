import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queries: [] as Array<{ queryKey: readonly unknown[]; enabled?: boolean }>,
  mutations: [] as Array<{ mutationFn: unknown; onSuccess: unknown }>,
  useQuery: vi.fn((options: { queryKey: readonly unknown[]; enabled?: boolean }) => {
    mocks.queries.push(options)
    return { data: undefined }
  }),
  useMutation: vi.fn((options: { mutationFn: unknown; onSuccess: unknown }) => {
    mocks.mutations.push(options)
    return { mutate: vi.fn() }
  }),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: mocks.useQuery,
  useMutation: mocks.useMutation,
  useQueryClient: mocks.useQueryClient,
}))

vi.mock('../../services/appSettings', () => ({
  fetchAppSettings: vi.fn(),
  setCommunicationsEnabled: vi.fn(),
}))

import { useAppSettings, useSetCommunicationsEnabled } from '../useAppSettings'

describe('hooks de app settings', () => {
  beforeEach(() => {
    mocks.queries.length = 0
    mocks.mutations.length = 0
  })

  it('usa a chave estável e permite desabilitar a consulta', () => {
    useAppSettings(false)

    expect(mocks.queries.at(-1)).toMatchObject({
      queryKey: ['app-settings'],
      enabled: false,
    })
  })

  it('expõe a mutação com invalidação do singleton', () => {
    useSetCommunicationsEnabled()

    expect(mocks.mutations).toHaveLength(1)
    expect(mocks.mutations[0].mutationFn).toBeTypeOf('function')
    expect(mocks.mutations[0].onSuccess).toBeTypeOf('function')
  })
})
