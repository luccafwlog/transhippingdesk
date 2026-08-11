import { FIXTURE_PREFIX, assertFixtureConfig } from './fixture-config.mjs'

async function rpc(client, name, payload) {
  const result = await client.rpc(name, payload)
  if (result?.error) throw result.error
  return result?.data ?? null
}

function requireFixture(fixture) {
  assertFixtureConfig()
  if (!fixture || fixture.prefix !== FIXTURE_PREFIX) throw new Error('fixture prefix mismatch')
  if (!fixture.userId || (fixture.customers?.length ?? 0) < 4) throw new Error('fixture requires four customers')
  if (!process.env.QA_PORTAL_FIXTURE_PASSWORD || process.env.QA_PORTAL_FIXTURE_PASSWORD.length < 8) {
    throw new Error('QA_PORTAL_FIXTURE_PASSWORD is required and is never persisted by this script')
  }
}

function paymentId(result) {
  const id = result?.payment_id ?? result?.id
  if (id == null) throw new Error('payment RPC did not return a payment id')
  return id
}

export async function createPortalScenarios(client, fixture) {
  requireFixture(fixture)
  const accounts = []
  const accountStates = [true, true, false, true]
  for (const [index, customer] of fixture.customers.slice(0, 4).entries()) {
    await rpc(client, 'upsert_customer_portal_account', {
      p_customer_id: customer.id,
      p_password: process.env.QA_PORTAL_FIXTURE_PASSWORD,
      p_contact_email: null,
      p_active: accountStates[index],
      p_actor: fixture.userId,
      p_login_cnpj: null,
    })
    accounts.push({ customerId: customer.id, active: accountStates[index] })
  }

  const event = await rpc(client, 'portal_return_to_analysis', {
    p_customer_id: fixture.customers[1].id,
    p_reason: `${FIXTURE_PREFIX} synthetic portal review`,
    p_actor_type: 'administrativo',
    p_request_id: 'QAD26-PORTAL-EVENT-001',
  })

  const invoiceIds = fixture.invoiceIds ?? []
  if (invoiceIds.length < 4) throw new Error('fixture requires four invoice ids for PIX scenarios')
  const reconciliations = []
  const exact = await rpc(client, 'register_ledger_invoice_payment', {
    p_invoice_id: invoiceIds[0], p_amount_brl: 1, p_method: 'pix', p_pix_txid: 'QAD26-TEST-PIX-EXACT',
    p_source: 'pix_extract', p_notes: 'QAD26-TEST exact PIX', p_actor: fixture.userId,
  })
  reconciliations.push({ status: 'exact', paymentId: paymentId(exact) })
  const partial = await rpc(client, 'register_ledger_invoice_payment', {
    p_invoice_id: invoiceIds[1], p_amount_brl: 1, p_method: 'pix', p_pix_txid: null,
    p_source: 'manual', p_notes: 'QAD26-TEST partial payment', p_actor: fixture.userId,
  })
  reconciliations.push({ status: 'partial', paymentId: paymentId(partial) })
  const overpaid = await rpc(client, 'register_ledger_invoice_payment', {
    p_invoice_id: invoiceIds[2], p_amount_brl: 2, p_method: 'pix', p_pix_txid: null,
    p_source: 'manual', p_notes: 'QAD26-TEST overpayment', p_actor: fixture.userId,
  })
  reconciliations.push({ status: 'overpaid', paymentId: paymentId(overpaid) })
  const reversible = await rpc(client, 'register_ledger_invoice_payment', {
    p_invoice_id: invoiceIds[3], p_amount_brl: 1, p_method: 'pix', p_pix_txid: null,
    p_source: 'manual', p_notes: 'QAD26-TEST reversible payment', p_actor: fixture.userId,
  })
  const reversiblePaymentId = paymentId(reversible)
  await rpc(client, 'reverse_invoice_payment', {
    p_payment_id: reversiblePaymentId,
    p_reason: 'QAD26-TEST synthetic reversal',
    p_actor: fixture.userId,
  })
  reconciliations.push({ status: 'reverted', paymentId: reversiblePaymentId })

  return { accounts, event: { result: event, requestId: 'QAD26-PORTAL-EVENT-001' }, reconciliations }
}
