import test from 'node:test'
import assert from 'node:assert/strict'

test('operational fixture uses only synthetic identifiers', async () => {
  const module = await import('./create-operational.mjs')
  assert.equal(module.createOperationalFixture.name, 'createOperationalFixture')
})
