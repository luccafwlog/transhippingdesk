import { FIXTURE_PREFIX, assertFixtureConfig } from './fixture-config.mjs'

async function rpc(client, name, payload) {
  const result = await client.rpc(name, payload)
  if (result?.error) throw result.error
  return result?.data ?? null
}

function requireFixture(fixture) {
  assertFixtureConfig()
  if (!fixture || fixture.prefix !== FIXTURE_PREFIX) throw new Error('fixture prefix mismatch')
  if (!fixture.userId || !fixture.customers?.[0]?.id) throw new Error('fixture identity and customer are required')
  if ((fixture.bls?.length ?? 0) < 4) throw new Error('fixture requires four B/Ls for financial scenarios')
}

function invoiceId(result) {
  const id = result?.invoice_id ?? result?.id
  if (id == null) throw new Error('invoice RPC did not return an invoice id')
  return id
}

export async function createFinancialScenarios(client, fixture) {
  requireFixture(fixture)
  const customerId = fixture.customers[0].id
  const blIds = fixture.bls.map((row) => row.id)
  const states = []

  const issued = await rpc(client, 'create_invoice_from_bls_with_ledger', {
    p_bl_ids: [blIds[0]], p_customer_id: customerId, p_due_date: '2026-12-30',
    p_notes: `${FIXTURE_PREFIX} issued`, p_issue_now: true, p_actor: fixture.userId,
  })
  states.push({ status: 'issued', invoiceId: invoiceId(issued) })

  const partial = await rpc(client, 'create_invoice_from_bls_with_ledger', {
    p_bl_ids: [blIds[1]], p_customer_id: customerId, p_due_date: '2026-12-30',
    p_notes: `${FIXTURE_PREFIX} partial`, p_issue_now: true, p_actor: fixture.userId,
  })
  const partialId = invoiceId(partial)
  await rpc(client, 'register_ledger_invoice_payment', {
    p_invoice_id: partialId, p_amount_brl: 1, p_method: 'pix',
    p_pix_txid: null, p_source: 'manual',
    p_notes: 'QAD26-TEST partial payment', p_actor: fixture.userId,
  })
  states.push({ status: 'partially_paid', invoiceId: partialId })

  const paid = await rpc(client, 'create_invoice_from_bls_with_ledger', {
    p_bl_ids: [blIds[2]], p_customer_id: customerId, p_due_date: '2026-12-30',
    p_notes: `${FIXTURE_PREFIX} paid`, p_issue_now: true, p_actor: fixture.userId,
  })
  const paidId = invoiceId(paid)
  await rpc(client, 'register_ledger_invoice_payment', {
    p_invoice_id: paidId, p_amount_brl: 1, p_method: 'pix',
    p_pix_txid: 'QAD26-TEST-PAID', p_source: 'pix_extract',
    p_notes: 'QAD26-TEST paid payment', p_actor: fixture.userId,
  })
  states.push({ status: 'paid', invoiceId: paidId })

  const overdue = await rpc(client, 'create_invoice_from_bls_with_ledger', {
    p_bl_ids: [blIds[3]], p_customer_id: customerId, p_due_date: '2020-01-01',
    p_notes: `${FIXTURE_PREFIX} overdue`, p_issue_now: true, p_actor: fixture.userId,
  })
  states.push({ status: 'overdue', invoiceId: invoiceId(overdue) })

  const cancelled = await rpc(client, 'create_invoice_from_bls_with_ledger', {
    p_bl_ids: [blIds[4] ?? 'QAD26-BL-005'], p_customer_id: customerId, p_due_date: '2026-12-30',
    p_notes: `${FIXTURE_PREFIX} cancelled`, p_issue_now: true, p_actor: fixture.userId,
  })
  const cancelledId = invoiceId(cancelled)
  await rpc(client, 'cancel_invoice', { p_invoice_id: cancelledId, p_reason: 'QAD26-TEST cancellation', p_actor: fixture.userId })
  states.push({ status: 'cancelled', invoiceId: cancelledId })

  const consolidated = await rpc(client, 'create_local_consolidated_invoice', {
    p_customer_id: customerId, p_receivable_ids: fixture.receivables ?? [],
    p_due_date: '2026-12-30', p_notes: `${FIXTURE_PREFIX} consolidated`, p_actor: fixture.userId,
  })
  states.push({ status: 'consolidated', invoiceId: invoiceId(consolidated) })

  const demurrage = await rpc(client, 'create_demurrage_invoice_with_items', {
    p_doc_number: 'QAD26-DEM-002', p_bl_id: blIds[0], p_customer_id: customerId,
    p_total_usd: 180, p_ready_at: '2026-08-20', p_roe_manual: true, p_roe: 5.4,
    p_current_roe: 5.4, p_roe_source: 'manual', p_items: [],
  })

  return { states, demurrage: { docNumber: 'QAD26-DEM-002', result: demurrage } }
}
