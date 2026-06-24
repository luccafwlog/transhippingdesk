import { beforeEach, expect, it, vi } from 'vitest'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
vi.mock('../../supabase', () => ({ supabase: { from: fromMock } }))
vi.mock('../demurrageRates', () => ({
  ensureDemurrageRatesLoaded: vi.fn(() => Promise.resolve()),
  invalidateDemurrageRatesCache: vi.fn(),
  calculateDemurrage: vi.fn(),
}))

import {
  issueInvoice,
  unissueInvoice,
  markInvoicePaid,
  cancelDemurrageInvoice,
  updateDemurrageInvoice,
  getInvoiceDetail,
} from '../demurrageInvoices'
import { listDemurrageContainers } from '../demurrageContainers'
import { fetchDemurrageKPIs } from '../demurrageKpis'

type Result = { data?: unknown; error: unknown; count?: number }
let results: Record<string, Result>
let builders: Map<string, Record<string, ReturnType<typeof vi.fn>>>

function makeBuilder(result: Result) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'update', 'order', 'gte', 'lte', 'not', 'neq', 'insert', 'delete', 'upsert', 'range', 'in']) {
    b[m] = vi.fn(() => b)
  }
  b.single = vi.fn(() => b)
  b.overrideTypes = vi.fn(() => Promise.resolve(result))
  b.then = (resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return b as Record<string, ReturnType<typeof vi.fn>>
}

function builderFor(table: string) {
  if (!builders.has(table)) builders.set(table, makeBuilder(results[table] ?? { data: [], error: null }))
  return builders.get(table)!
}

function lastUpdate(table: string) {
  const calls = builderFor(table).update.mock.calls
  return calls[calls.length - 1]?.[0] as Record<string, unknown>
}

beforeEach(() => {
  results = {}
  builders = new Map()
  fromMock.mockReset()
  fromMock.mockImplementation((table: string) => builderFor(table))
})

it('US-041: emite a invoice congelando ROE e total BRL', async () => {
  results.demurrage_invoices = { data: { total_usd: 100, discount_mode: null, discount_value: null, first_billed_at: null, doc_number: 'DEM-1' }, error: null }
  await issueInvoice(5, 5)
  expect(lastUpdate('demurrage_invoices')).toMatchObject({ status: 'issued', current_roe: 5, current_total_brl: 500 })
})

it('US-042: desemite a invoice voltando para draft', async () => {
  results.demurrage_invoices = { data: null, error: null }
  await unissueInvoice(5)
  expect(lastUpdate('demurrage_invoices')).toMatchObject({ status: 'draft', current_roe: null, current_total_brl: null })
})

it('US-043: marca como paga uma invoice emitida', async () => {
  results.demurrage_invoices = { data: { status: 'issued', current_roe: 5, current_total_brl: 500, total_usd: 100, doc_number: 'DEM-1' }, error: null }
  await markInvoicePaid(5, '2026-06-23')
  expect(lastUpdate('demurrage_invoices')).toMatchObject({ status: 'paid', paid_at: '2026-06-23' })
})

it('US-043: rejeita marcar paga uma invoice em draft', async () => {
  results.demurrage_invoices = { data: { status: 'draft', doc_number: 'DEM-1' }, error: null }
  await expect(markInvoicePaid(5, '2026-06-23')).rejects.toThrow(/status atual/)
})

it('US-045: cancela a invoice', async () => {
  results.demurrage_invoices = { data: null, error: null }
  await cancelDemurrageInvoice(5)
  expect(lastUpdate('demurrage_invoices')).toMatchObject({ status: 'cancelled' })
})

it('US-047: abre/atualiza disputa via patch', async () => {
  results.demurrage_invoices = { data: null, error: null }
  await updateDemurrageInvoice(5, { dispute_open: true, dispute_subject: 'Cobranca indevida', dispute_status: 'aberto' })
  expect(lastUpdate('demurrage_invoices')).toMatchObject({ dispute_open: true, dispute_subject: 'Cobranca indevida' })
})

it('US-040: abre o detalhe da invoice com header e itens', async () => {
  results.demurrage_invoices = { data: { id: 5, doc_number: 'DEM-1' }, error: null }
  results.demurrage_invoice_items = { data: [{ id: 1, container_number: 'C1' }], error: null }
  const detail = await getInvoiceDetail(5)
  expect(detail.invoice).toMatchObject({ id: 5 })
  expect(detail.items).toHaveLength(1)
})

it('US-030: lista os containers em tracking e filtra por cliente', async () => {
  results.bl_containers = { data: [{ id: 1, bl: { customer: { id: 9 }, voyage_id: 2 } }, { id: 2, bl: { customer: { id: 7 }, voyage_id: 3 } }], error: null }
  const all = await listDemurrageContainers()
  expect(all).toHaveLength(2)
  const filtered = await listDemurrageContainers({ customerId: 9 })
  expect(filtered).toHaveLength(1)
})

it('US-031: calcula os KPIs de demurrage', async () => {
  results.bl_containers = { data: [], count: 3, error: null }
  results.demurrage_invoices = { data: [{ total_usd: 50, current_total_brl: 200 }], error: null }
  const kpis = await fetchDemurrageKPIs()
  expect(kpis.overdueContainers).toBe(3)
  expect(kpis.draftInvoicesTotalUsd).toBe(50)
  expect(kpis.issuedInvoicesTotalBrl).toBe(200)
})
