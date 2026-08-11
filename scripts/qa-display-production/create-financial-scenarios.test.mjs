import test from 'node:test'
import assert from 'node:assert/strict'

test('builds local-charge, demurrage and consolidated financial scenarios', async () => {
  const { createFinancialScenarios } = await import('./create-financial-scenarios.mjs')
  const calls = []
  let sequence = 100
  const client = {
    rpc(name, payload) {
      calls.push({ name, payload })
      return Promise.resolve({ data: { invoice_id: sequence++, payment_id: sequence++ }, error: null })
    },
  }
  const result = await createFinancialScenarios(client, {
    prefix: 'QA-DISPLAY-2026',
    userId: '00000000-0000-0000-0000-000000000001',
    customers: [{ id: 1 }],
    bls: [{ id: 'QAD26-BL-001' }, { id: 'QAD26-BL-002' }, { id: 'QAD26-BL-003' }, { id: 'QAD26-BL-004' }],
    receivables: [11, 12],
  })

  assert.deepEqual(result.states.map((item) => item.status), ['issued', 'partially_paid', 'paid', 'overdue', 'cancelled', 'consolidated'])
  assert.equal(result.demurrage.docNumber, 'QAD26-DEM-002')
  assert.ok(calls.some((call) => call.name === 'create_local_consolidated_invoice'))
  assert.ok(calls.every((call) => JSON.stringify(call.payload).includes('QAD26-TEST') || call.name === 'create_invoice_from_bls_with_ledger' || call.name === 'create_local_consolidated_invoice' || call.name === 'create_demurrage_invoice_with_items' || call.name === 'cancel_invoice'))
})
