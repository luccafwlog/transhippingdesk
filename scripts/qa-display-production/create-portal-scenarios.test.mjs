import test from 'node:test'
import assert from 'node:assert/strict'

test('creates portal account states and PIX reconciliation scenarios without returning secrets', async () => {
  process.env.QA_PORTAL_FIXTURE_PASSWORD = 'fixture-password-only-in-test'
  const { createPortalScenarios } = await import('./create-portal-scenarios.mjs')
  const calls = []
  let sequence = 200
  const client = {
    rpc(name, payload) {
      calls.push({ name, payload })
      return Promise.resolve({ data: { id: sequence++, invoice_id: 41, payment_id: 51 }, error: null })
    },
  }
  const result = await createPortalScenarios(client, {
    prefix: 'QA-DISPLAY-2026', userId: '00000000-0000-0000-0000-000000000001',
    customers: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
    invoiceIds: [41, 42, 43, 44],
  })

  assert.deepEqual(result.reconciliations.map((item) => item.status), ['exact', 'partial', 'overpaid', 'reverted'])
  assert.equal(result.accounts.length, 4)
  assert.equal(JSON.stringify(result).includes('fixture-password-only-in-test'), false)
  assert.ok(calls.some((call) => call.name === 'reverse_invoice_payment'))
})
