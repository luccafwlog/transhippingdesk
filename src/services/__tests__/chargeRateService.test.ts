import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listCustomerRateOverrides } from '../charges/chargeRateService'

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: { from: mockFrom },
}))

describe('listCustomerRateOverrides', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('continua paginando antes de aplicar filtros para nao esconder overrides antigos', async () => {
    const oldMatchingOverride = {
      id: 501,
      customer_id: 9,
      charge_item_id: 12,
      override_value: 99,
      valid_from: null,
      valid_to: null,
      notes: null,
      created_at: '2025-01-01T00:00:00Z',
      customer: { id: 9, name: 'Cliente Antigo', cnpj_cpf: '009' },
      charge_item: {
        id: 12,
        name: 'THD',
        currency: 'BRL',
        unit_value_brl: 100,
        unit_value_usd: null,
        charge_table: {
          id: 2,
          name: 'Tabela',
          cargo_mode: 'container',
          pod: 'BRVIT',
          valid_from: '2025-01-01',
          valid_to: null,
          active: true,
        },
      },
    }
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      ...oldMatchingOverride,
      id: index + 1,
      customer: { id: index + 1, name: `Outro ${index}`, cnpj_cpf: String(index) },
    }))
    let page = 0
    const builder = {
      select: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      range: vi.fn(() => {
        page += 1
        return builder
      }),
      overrideTypes: vi.fn(() => builder),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          data: page <= 1 ? firstPage : [oldMatchingOverride],
          error: null,
        }).then(resolve),
    }
    mockFrom.mockReturnValue(builder)

    const rows = await listCustomerRateOverrides({
      customerSearch: 'Cliente Antigo',
      cargoMode: 'container',
      pod: 'BRVIT',
      limit: 20,
    })

    expect(rows).toEqual([oldMatchingOverride])
    expect(builder.range).toHaveBeenCalledTimes(2)
  })
})
