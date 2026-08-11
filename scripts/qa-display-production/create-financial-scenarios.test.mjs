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
    customers: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
    bls: [
      { id: 'QAD26-BL-001', customer_id: 1 }, { id: 'QAD26-BL-002', customer_id: 2 },
      { id: 'QAD26-BL-003', customer_id: 3 }, { id: 'QAD26-BL-004', customer_id: 4 },
      { id: 'QAD26-BL-005', customer_id: 1 }, { id: 'QAD26-BL-006', customer_id: 2, container_id: 11 },
    ],
    receivables: [11, 12],
  })

  assert.deepEqual(result.states.map((item) => item.status), ['issued', 'partially_paid', 'paid', 'overdue', 'cancelled', 'consolidated'])
  assert.equal(result.demurrage.docNumber, 'QAD26-DEM-002')
  assert.ok(calls.some((call) => call.name === 'create_local_consolidated_invoice'))
  assert.ok(calls.some((call) => call.name === 'mark_bl_ready_for_billing'))
})

test('fails before any mutation when a financial precondition is missing', async () => {
  const { createFinancialScenarios } = await import('./create-financial-scenarios.mjs')
  let mutations = 0
  await assert.rejects(() => createFinancialScenarios({ rpc: async () => { mutations += 1 } }, {
    prefix: 'QA-DISPLAY-2026', userId: 'qa-user', customers: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
    bls: [{ id: 'QAD26-BL-001', customer_id: 1 }], receivables: [],
  }), /six B\/Ls|receivable/)
  assert.equal(mutations, 0)
})
