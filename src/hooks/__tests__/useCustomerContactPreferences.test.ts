import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mutations: [] as Array<{ onSuccess: (data: unknown, input: { customerId: number }) => Promise<void> }>,
  invalidateQueries: vi.fn(),
  useMutation: vi.fn((options: { onSuccess: (data: unknown, input: { customerId: number }) => Promise<void> }) => {
    mocks.mutations.push(options)
    return { mutate: vi.fn(), isPending: false }
  }),
  useQueryClient: vi.fn(() => ({ invalidateQueries: mocks.invalidateQueries })),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: mocks.useMutation,
  useQueryClient: mocks.useQueryClient,
}))

vi.mock('../../services/customerContactPreferences', () => ({
  updateCustomerContactPreference: vi.fn(),
}))

import { useUpdateCustomerContactPreference } from '../useCustomerContactPreferences'

describe('hook de preferências de contato', () => {
  beforeEach(() => {
    mocks.mutations.length = 0
    mocks.invalidateQueries.mockReset()
  })

  it('invalida ficha do cliente e timeline após salvar', async () => {
    useUpdateCustomerContactPreference()
    await mocks.mutations[0].onSuccess({}, { customerId: 101 })

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['customer-detail'] })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['customer-ficha', 'timeline', 101] })
  })
})
