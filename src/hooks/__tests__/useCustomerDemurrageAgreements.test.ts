import { describe, expect, it, vi, beforeEach } from 'vitest'

type QueryOptions = { enabled?: boolean }

const mocks = vi.hoisted(() => {
  const calls: QueryOptions[] = []
  return {
    calls,
    useQuery: (options: QueryOptions) => {
      calls.push(options)
      return { data: undefined }
    },
  }
})

vi.mock('@tanstack/react-query', () => ({
  useQuery: mocks.useQuery,
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
}))
vi.mock('../../services/demurrage/customerDemurrageAgreements', () => ({
  listCustomerDemurrageAgreements: vi.fn(),
  saveCustomerDemurrageAgreement: vi.fn(),
  deleteCustomerDemurrageAgreement: vi.fn(),
  toggleCustomerDemurrageAgreementActive: vi.fn(),
}))

import { useCustomerDemurrageAgreements } from '../useCustomerDemurrageAgreements'

function ultimoEnabled() {
  return mocks.calls[mocks.calls.length - 1]?.enabled
}

// `listCustomerDemurrageAgreements` só aplica `.eq('customer_id', …)` quando o
// filtro traz um id — "sem customerId" significa "todos", e a aba de acordos
// usa isso de propósito. Quem pergunta pelos acordos DE UM cliente precisa não
// consultar quando não há cliente: sem o guard, a consulta volta com os acordos
// de todos e quem escolhe por data acaba aplicando o acordo de outro cliente.
describe('useCustomerDemurrageAgreements', () => {
  beforeEach(() => {
    mocks.calls.length = 0
  })

  it('não consulta quando o chamador diz que não há cliente', () => {
    useCustomerDemurrageAgreements({ customerId: undefined, activeOnly: true }, false)
    expect(ultimoEnabled()).toBe(false)
  })

  it('consulta normalmente quando há cliente', () => {
    useCustomerDemurrageAgreements({ customerId: 7, activeOnly: true }, true)
    expect(ultimoEnabled()).toBe(true)
  })

  // A aba de acordos continua listando todos, sem passar o segundo argumento.
  it('mantém a listagem geral habilitada por padrão', () => {
    useCustomerDemurrageAgreements()
    expect(ultimoEnabled()).toBe(true)
  })
})
