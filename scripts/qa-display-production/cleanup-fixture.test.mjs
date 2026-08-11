import test from 'node:test'
import assert from 'node:assert/strict'

const base = () => ({ prefix: 'QA-DISPLAY-2026', customers: [{ id: 'QAD26-CUSTOMER-1' }], bls: [{ id: 'QAD26-BL-001' }], bl_containers: [{ id: 'QAD26-CONTAINER-1' }] })

test('rejects an empty catalog, a mismatched prefix and an outside identifier', async () => {
  const { cleanupFixture } = await import('./cleanup-fixture.mjs')
  await assert.rejects(() => cleanupFixture({}, {}, { dryRun: true }), /catalog/i)
  await assert.rejects(() => cleanupFixture({}, { ...base(), prefix: 'OTHER' }, { dryRun: true }), /prefix/i)
  await assert.rejects(() => cleanupFixture({}, { ...base(), bls: [{ id: 'foreign-id' }] }, { dryRun: true }), /outside|fixture/i)
})

test('dry-run returns dependency order without deleting anything', async () => {
  const { cleanupFixture } = await import('./cleanup-fixture.mjs')
  const calls = []
  const result = await cleanupFixture({ from: (...args) => { calls.push(args); return {} } }, base(), { dryRun: true })
  assert.equal(result.dryRun, true)
  assert.ok(result.operations.findIndex((item) => item.table === 'bls') > result.operations.findIndex((item) => item.table === 'bl_containers'))
  assert.deepEqual(calls, [])
})
