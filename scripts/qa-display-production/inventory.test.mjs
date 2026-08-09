import test from 'node:test'
import assert from 'node:assert/strict'
import { assertFixtureConfig, PROTECTED_TABLES } from './fixture-config.mjs'

test('fixture config uses an isolated prefix and protects reference tables', () => {
  assert.equal(assertFixtureConfig(), true)
  assert.deepEqual(PROTECTED_TABLES, ['charge_tables', 'charge_table_items', 'depots', 'terminals', 'services'])
})
