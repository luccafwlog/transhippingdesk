import test from 'node:test'
import assert from 'node:assert/strict'

test('creates an idempotent omission with transshipment and COD scenarios', async () => {
  const { createAdrScenarios } = await import('./create-adr-scenarios.mjs')
  const calls = []
  const client = {
    rpc(name, payload) {
      calls.push({ name, payload })
      if (name === 'omit_voyage_escala') return Promise.resolve({ data: 91, error: null })
      return Promise.resolve({ data: null, error: null })
    },
  }
  const result = await createAdrScenarios(client, {
    prefix: 'QA-DISPLAY-2026',
    userId: '00000000-0000-0000-0000-000000000001',
    voyages: [{ id: 34, number: 'QAD26A' }],
    bls: [{ id: 'QAD26-BL-001', pod: 'SALVADOR' }, { id: 'QAD26-BL-004', pod: 'SALVADOR' }],
  })

  assert.deepEqual(result, {
    omissionId: 91,
    voyageId: 34,
    transshipmentBlId: 'QAD26-BL-001',
    codBlId: 'QAD26-BL-004',
  })
  assert.deepEqual(calls.map((call) => call.name), [
    'omit_voyage_escala',
    'set_bl_transshipment',
    'set_bl_cod',
  ])
  assert.equal(calls[0].payload.p_voyage_id, 34)
  assert.equal(calls[1].payload.p_bl_id, 'QAD26-BL-001')
  assert.equal(calls[2].payload.p_bl_id, 'QAD26-BL-004')
})
