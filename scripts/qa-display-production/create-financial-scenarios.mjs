import { FIXTURE_PREFIX, assertFixtureConfig } from './fixture-config.mjs'
import { requireIds } from './fixture-catalog.mjs'

async function rpc(client, name, payload) {
  const result = await client.rpc(name, payload)
  if (result?.error) throw result.error
  return result?.data ?? null
}

async function rows(client, table, columns, predicate) {
  if (typeof client?.from !== 'function') return null
  const result = await predicate(client.from(table).select(columns))
  if (result?.error) throw result.error
  return result?.data ?? []
}

async function loadBillingPreconditions(client, fixture) {
  const selected = fixture.bls.slice(1, 6)
  if (typeof client?.from !== 'function') return selected
  const result = await client.from('bls').select('id,customer_id,financial_status,container_id,pod').in('id', selected.map((bl) => bl.id))
  if (result.error) throw result.error
  const byId = new Map((result.data ?? []).map((bl) => [bl.id, bl]))
  if (byId.size !== selected.length) throw new Error('financial fixture B/L catalog does not match the database')
  for (const expected of selected) {
    const actual = byId.get(expected.id)
    if (actual.customer_id !== expected.customer_id) throw new Error(`customer mismatch for B/L ${expected.id}`)
    if (!['pending', 'ready_for_billing'].includes(actual.financial_status)) throw new Error(`B/L ${expected.id} is not available for billing: ${actual.financial_status}`)
    Object.assign(expected, actual)
  }
  return selected
}

function requireFixture(fixture) {
  assertFixtureConfig()
  if (!fixture || fixture.prefix !== FIXTURE_PREFIX) throw new Error('fixture prefix mismatch')
  if (!fixture.userId || (fixture.customers?.length ?? 0) < 4) throw new Error('fixture identity and four customers are required')
  if ((fixture.bls?.length ?? 0) < 6) throw new Error('fixture requires six B/Ls for financial scenarios')
  requireIds(fixture, 'receivables')
  const selected = fixture.bls.slice(1, 6)
  if (new Set(selected.map((bl) => bl.id)).size !== 5) throw new Error('financial scenarios require five distinct B/Ls')
  for (const bl of selected) {
    if (!bl.customer_id) throw new Error(`B/L ${bl.id} has no customer`)
    if (bl.financial_status && !['pending', 'ready_for_billing'].includes(bl.financial_status)) {
      throw new Error(`B/L ${bl.id} is not available for billing: ${bl.financial_status}`)
    }
  }
}

function invoiceId(result) {
  const id = result?.invoice_id ?? result?.id
  if (id == null) throw new Error('invoice RPC did not return an invoice id')
  return id
}

async function prepareBl(client, fixture, bl) {
  await rpc(client, 'calculate_bl_local_charges', { p_bl_id: bl.id, p_actor: fixture.userId, p_recalculate: true })
  await rpc(client, 'refresh_customer_reconciliation_queue_for_bl', { p_bl_id: bl.id })
  if (typeof client?.from === 'function') {
    const pending = await rows(client, 'customer_reconciliation_queue', 'id,customer_id,status', (query) => query.eq('bl_id', bl.id).eq('status', 'pending'))
    for (const item of pending) {
      await rpc(client, 'approve_customer_reconciliation', { p_queue_id: item.id, p_customer_id: bl.customer_id, p_notes: `${FIXTURE_PREFIX} approval`, p_actor: fixture.userId })
    }
  }
  await rpc(client, 'mark_bl_ready_for_billing', { p_bl_id: bl.id, p_actor: fixture.userId })
}

async function openBalance(client, invoice, result) {
  if (typeof client?.from === 'function') {
    const found = await rows(client, 'invoices', 'id,balance_due,total_amount,total_amount_brl,amount_paid', (query) => query.eq('id', invoice.id).limit(1))
    const row = found?.[0]
    const balance = Number(row?.balance_due ?? row?.total_amount_brl ?? row?.total_amount) - Number(row?.amount_paid ?? 0)
    if (!Number.isFinite(balance) || balance <= 0) throw new Error(`invoice ${invoice.id} has no positive open balance`)
    return balance
  }
  const declared = Number(result?.balance_due ?? result?.total_amount_brl ?? result?.amount_due ?? 1)
  if (!Number.isFinite(declared) || declared <= 0) throw new Error(`invoice ${invoice.id} has no positive open balance`)
  return declared
}

async function createInvoice(client, fixture, bl, status) {
  await prepareBl(client, fixture, bl)
  const result = await rpc(client, 'create_invoice_from_bls_with_ledger', {
    p_bl_ids: [bl.id], p_customer_id: bl.customer_id,
    p_notes: `${FIXTURE_PREFIX} ${status}`, p_issue_now: true, p_actor: fixture.userId,
  })
  return { id: invoiceId(result), blId: bl.id, customerId: bl.customer_id, status, usedBy: 'financial', created: true, result }
}

export async function createFinancialScenarios(client, fixture) {
  requireFixture(fixture)
  // Sem cenário 'overdue': taxa local não tem vencimento praticado (ADR 0055).
  const [issuedBl, partialBl, paidBl, , cancelledBl] = await loadBillingPreconditions(client, fixture)
  const states = []
  const invoices = []

  // All B/L ownership, availability, receivables and container preconditions are checked above.
  const issued = await createInvoice(client, fixture, issuedBl, 'issued')
  invoices.push(issued); states.push({ status: 'issued', invoiceId: issued.id })

  const partial = await createInvoice(client, fixture, partialBl, 'partially_paid')
  const partialBalance = await openBalance(client, partial, partial.result)
  await rpc(client, 'register_ledger_invoice_payment', {
    p_invoice_id: partial.id, p_amount_brl: Math.max(0.01, Math.min(partialBalance / 2, partialBalance - 0.01)), p_method: 'pix',
    p_pix_txid: null, p_source: 'manual', p_notes: 'QAD26-TEST partial payment', p_actor: fixture.userId,
  })
  invoices.push(partial); states.push({ status: 'partially_paid', invoiceId: partial.id })

  const paid = await createInvoice(client, fixture, paidBl, 'paid')
  const paidBalance = await openBalance(client, paid, paid.result)
  await rpc(client, 'register_ledger_invoice_payment', {
    p_invoice_id: paid.id, p_amount_brl: paidBalance, p_method: 'pix', p_pix_txid: 'QAD26-TEST-PAID',
    p_source: 'pix_extract', p_notes: 'QAD26-TEST paid payment', p_actor: fixture.userId,
  })
  invoices.push(paid); states.push({ status: 'paid', invoiceId: paid.id })

  const cancelled = await createInvoice(client, fixture, cancelledBl, 'cancelled')
  await rpc(client, 'cancel_invoice', { p_invoice_id: cancelled.id, p_reason: 'QAD26-TEST cancellation', p_actor: fixture.userId })
  invoices.push(cancelled); states.push({ status: 'cancelled', invoiceId: cancelled.id })

  const receivables = requireIds(fixture, 'receivables')
  const consolidated = await rpc(client, 'create_local_consolidated_invoice', {
    p_customer_id: issued.customerId, p_receivable_ids: receivables,
    p_notes: `${FIXTURE_PREFIX} consolidated`, p_actor: fixture.userId,
  })
  const consolidatedInvoice = { id: invoiceId(consolidated), status: 'consolidated', usedBy: 'financial', created: true }
  invoices.push(consolidatedInvoice); states.push({ status: 'consolidated', invoiceId: consolidatedInvoice.id })

  const demurrageBl = fixture.bls[5]
  if (!demurrageBl.container_id) throw new Error(`B/L ${demurrageBl.id} has no container for demurrage scenario`)
  const demurrageItems = [{
    container_id: demurrageBl.container_id, container_number: demurrageBl.container_number ?? `QAD26-${demurrageBl.id}-CNT`,
    container_type: demurrageBl.container_type ?? '40HC', discharge_date: '2026-08-01', return_date: '2026-08-12',
    total_days: 11, free_days: 5, days_p1: 5, rate_p1_usd: 20, days_p2: 1, rate_p2_usd: 40, subtotal_usd: 140,
  }]
  const demurrage = await rpc(client, 'create_demurrage_invoice_with_items', {
    p_doc_number: 'QAD26-DEM-002', p_bl_id: demurrageBl.id, p_customer_id: demurrageBl.customer_id,
    p_total_usd: 140, p_ready_at: '2026-08-20', p_roe_manual: true, p_roe: 5.4,
    p_current_roe: 5.4, p_roe_source: 'manual', p_items: demurrageItems,
  })

  return { states, invoices, receivables, demurrage: { docNumber: 'QAD26-DEM-002', result: demurrage, created: true } }
}

if ((await import('./fixture-runtime.mjs')).isMain(import.meta.url, process.argv[1])) {
  const { authClient, readCatalog, writeCatalog } = await import('./fixture-runtime.mjs')
  const { client, userId } = await authClient()
  const catalog = await readCatalog()
  catalog.userId = userId
  const result = await createFinancialScenarios(client, catalog)
  catalog.invoices = [...(catalog.invoices ?? []), ...result.invoices]
  const knownReceivables = new Map((catalog.receivables ?? []).map((item) => [item.id ?? item, item]))
  for (const id of result.receivables) if (!knownReceivables.has(id)) knownReceivables.set(id, { id, created: false })
  catalog.receivables = [...knownReceivables.values()]
  catalog.demurrage = result.demurrage
  await writeCatalog(catalog)
  console.log(JSON.stringify({ states: result.states, invoiceCount: result.invoices.length }, null, 2))
}
