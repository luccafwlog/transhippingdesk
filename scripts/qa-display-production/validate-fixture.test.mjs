import test from 'node:test'
import assert from 'node:assert/strict'

test('reports protected catalog entries before querying Supabase', async () => {
  const { validateFixture } = await import('./validate-fixture.mjs')
  let queried = false
  const client = { from() { queried = true; throw new Error('should not query protected catalog') } }
  const result = await validateFixture(client, {
    prefix: 'QA-DISPLAY-2026',
    protected: [{ table: 'charge_tables', id: 'QAD26-CHARGE-1' }],
  })
  assert.equal(queried, false)
  assert.deepEqual(result.violations, [{ table: 'charge_tables', reason: 'protected table appeared in catalog' }])
})
