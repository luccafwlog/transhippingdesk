import { FIXTURE_PREFIX, PROTECTED_TABLES, assertFixtureConfig } from './fixture-config.mjs'
import { assertCleanupCatalog } from './cleanup-fixture.mjs'

const TABLES = [
  ['voyages', 'id'], ['vessels', 'id'], ['customers', 'id'], ['bls', 'id'], ['bl_containers', 'id'],
  ['vehicles', 'id'], ['granite_bls', 'id'], ['invoices', 'id'], ['bl_receivables', 'id'],
  ['ledger_settlements', 'id'], ['demurrage_invoices', 'id'], ['customer_portal_accounts', 'id'],
  ['portal_notifications', 'id'], ['audit_logs', 'id'],
]

export async function validateFixture(client, catalog) {
  const entries = assertCleanupCatalog(catalog)
  const counts = {}
  const violations = []
  for (const [table, column] of TABLES) {
    const ids = entries.filter((entry) => entry.key === table || entry.table === table).map((entry) => entry.id)
    if (!ids.length) { counts[table] = 0; continue }
    const result = await client.from(table).select(column, { count: 'exact', head: true }).in(column, ids)
    if (result.error) throw result.error
    counts[table] = result.count ?? 0
    if (PROTECTED_TABLES.includes(table)) violations.push({ table, reason: 'protected table appeared in catalog' })
  }
  return { fixturePrefix: FIXTURE_PREFIX, counts, violations }
}
