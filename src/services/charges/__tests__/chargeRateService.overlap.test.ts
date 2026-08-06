import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
vi.mock('../../supabase', () => ({ supabase: { from: (table: string) => from(table) } }))

function builder(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'neq', 'overrideTypes']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return chain
}

// Etapa 10 do plano de faturamento (ADR 0038 decisão 5, achado 5): a checagem
// no app dá a mensagem amigável citando a condição que colide; a restrição de
// exclusão do banco (migration 267) é a autoridade final.
describe('findOverlappingCustomerRateOverride', () => {
  beforeEach(() => from.mockReset())

  it('encontra conflito quando os períodos se cruzam', async () => {
    const { findOverlappingCustomerRateOverride } = await import('../chargeRateService')
    from.mockImplementation(() =>
      builder({ data: [{ id: 5, valid_from: '2026-01-01', valid_to: '2026-06-30' }], error: null }),
    )

    const conflict = await findOverlappingCustomerRateOverride({
      customerId: 1,
      chargeItemId: 2,
      validFrom: '2026-06-01',
      validTo: '2026-12-31',
    })

    expect(conflict?.id).toBe(5)
  })

  it('nao encontra conflito quando os periodos nao se tocam', async () => {
    const { findOverlappingCustomerRateOverride } = await import('../chargeRateService')
    from.mockImplementation(() =>
      builder({ data: [{ id: 5, valid_from: '2026-01-01', valid_to: '2026-06-30' }], error: null }),
    )

    const conflict = await findOverlappingCustomerRateOverride({
      customerId: 1,
      chargeItemId: 2,
      validFrom: '2026-07-01',
      validTo: '2026-12-31',
    })

    expect(conflict).toBeNull()
  })

  it('trata vigencia sem limite (null) como conflitando com qualquer periodo', async () => {
    const { findOverlappingCustomerRateOverride } = await import('../chargeRateService')
    from.mockImplementation(() => builder({ data: [{ id: 5, valid_from: null, valid_to: null }], error: null }))

    const conflict = await findOverlappingCustomerRateOverride({
      customerId: 1,
      chargeItemId: 2,
      validFrom: '2030-01-01',
      validTo: null,
    })

    expect(conflict?.id).toBe(5)
  })

  it('exclui a propria linha ao editar (nao compara consigo mesma)', async () => {
    const { findOverlappingCustomerRateOverride } = await import('../chargeRateService')
    let neqCalledWith: unknown
    from.mockImplementation(() => {
      const b = builder({ data: [], error: null })
      ;(b.neq as ReturnType<typeof vi.fn>).mockImplementation((...args: unknown[]) => {
        neqCalledWith = args
        return b
      })
      return b
    })

    await findOverlappingCustomerRateOverride({ id: 5, customerId: 1, chargeItemId: 2, validFrom: null, validTo: null })

    expect(neqCalledWith).toEqual(['id', 5])
  })
})
