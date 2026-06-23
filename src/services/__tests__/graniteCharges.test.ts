import { beforeEach, expect, it, vi } from 'vitest'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { from: fromMock } }))

import {
  listGraniteRates,
  upsertGraniteRate,
  deleteGraniteRate,
  calculateGraniteBlCharges,
  listGraniteBls,
} from '../graniteCharges'

let results: Record<string, { data: unknown; error: unknown; count?: number }>
let builders: Map<string, Record<string, ReturnType<typeof vi.fn> & { mock?: unknown }>>

function makeBuilder(result: { data: unknown; error: unknown; count?: number }) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'order', 'upsert', 'delete', 'eq', 'or', 'in', 'update', 'insert', 'range']) {
    b[m] = vi.fn(() => b)
  }
  b.single = vi.fn(() => Promise.resolve(result))
  b.then = (resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return b as Record<string, ReturnType<typeof vi.fn>>
}

function builderFor(table: string) {
  if (!builders.has(table)) builders.set(table, makeBuilder(results[table] ?? { data: [], error: null }))
  return builders.get(table)!
}

beforeEach(() => {
  results = {}
  builders = new Map()
  fromMock.mockReset()
  fromMock.mockImplementation((table: string) => builderFor(table))
})

it('US-088: lista as taxas de granito', async () => {
  results.granite_rates = { data: [{ id: 'r1', description: 'Frete' }], error: null }
  await expect(listGraniteRates()).resolves.toEqual([{ id: 'r1', description: 'Frete' }])
})

it('US-089: cria/edita uma taxa via upsert', async () => {
  results.granite_rates = { data: { id: 'r1', description: 'Frete', active: true }, error: null }
  const rate = { description: 'Frete', charge_type: 'per_kg', unit_value: 2, currency: 'BRL', active: true } as never
  await upsertGraniteRate(rate)
  expect(builderFor('granite_rates').upsert).toHaveBeenCalledWith(rate, { onConflict: 'id' })
})

it('US-090: ativar/desativar usa upsert com a flag active', async () => {
  results.granite_rates = { data: { id: 'r1', active: false }, error: null }
  await upsertGraniteRate({ id: 'r1', description: 'Frete', charge_type: 'per_kg', unit_value: 2, currency: 'BRL', active: false } as never)
  expect(builderFor('granite_rates').upsert).toHaveBeenCalledWith(
    expect.objectContaining({ active: false }),
    { onConflict: 'id' },
  )
})

it('US-091: exclui uma taxa', async () => {
  results.granite_rates = { data: null, error: null }
  await deleteGraniteRate('r1')
  expect(builderFor('granite_rates').delete).toHaveBeenCalled()
  expect(builderFor('granite_rates').eq).toHaveBeenCalledWith('id', 'r1')
})

it('US-082: calcula as taxas do B/L aplicando per_kg sobre o peso real', async () => {
  results.granite_bls = { data: { id: 'BL1', real_weight_kg: 1000 }, error: null }
  results.granite_rates = {
    data: [{ id: 'r1', description: 'Frete', charge_type: 'per_kg', unit_value: 2, currency: 'BRL', active: true, valid_from: null, valid_to: null }],
    error: null,
  }
  results.granite_bl_charges = { data: [{ bl_id: 'BL1', subtotal: 2000 }], error: null }

  const charges = await calculateGraniteBlCharges('BL1')
  expect(charges).toEqual([{ bl_id: 'BL1', subtotal: 2000 }])

  const insertArg = (builderFor('granite_bl_charges').insert.mock.calls[0] as unknown[])[0] as Array<Record<string, unknown>>
  expect(insertArg[0]).toMatchObject({ bl_id: 'BL1', quantity: 1000, subtotal: 2000 })
})

it('US-081: lista/pagina B/Ls de granito e retorna rows + count', async () => {
  results.granite_bls = { data: [{ id: 'BL1' }, { id: 'BL2' }], error: null, count: 2 }
  const out = await listGraniteBls({ page: 1, pageSize: 20, search: 'BL' })
  expect(out).toEqual({ rows: [{ id: 'BL1' }, { id: 'BL2' }], count: 2 })
  expect(builderFor('granite_bls').range).toHaveBeenCalledWith(0, 19)
})
