import { FIXTURE_PREFIX, PROTECTED_TABLES, assertFixtureConfig } from './fixture-config.mjs'
import { assertCleanupCatalog } from './cleanup-fixture.mjs'
import { normalizeCatalog } from './fixture-catalog.mjs'

const TABLES = [
  ['voyages', 'id'], ['vessels', 'id'], ['customers', 'id'], ['bls', 'id'], ['bl_containers', 'id'],
  ['vehicles', 'id'], ['granite_bls', 'id'], ['invoices', 'id'], ['bl_receivables', 'id'],
  ['ledger_settlements', 'id'], ['demurrage_invoices', 'id'], ['customer_portal_accounts', 'id'],
  ['portal_notifications', 'id'], ['audit_logs', 'id'],
]

export async function validateFixture(client, catalog) {
  const entries = assertCleanupCatalog(catalog)
  const normalized = normalizeCatalog(catalog)
  const counts = {}
  const violations = []
  for (const table of new Set(normalized.map((entry) => entry.table))) {
    if (PROTECTED_TABLES.includes(table)) violations.push({ table, reason: 'protected table appeared in catalog' })
  }
  if (violations.length) return { fixturePrefix: FIXTURE_PREFIX, counts, violations }
  for (const [table, column] of TABLES) {
    const ids = normalized.filter((entry) => entry.table === table && entry.column === column).map((entry) => entry.id)
    if (!ids.length) { counts[table] = { expected: 0, returned: 0, matches: true }; continue }
    const result = await client.from(table).select(column, { count: 'exact', head: true }).in(column, ids)
    if (result.error) throw result.error
    counts[table] = { expected: ids.length, returned: result.count ?? 0, matches: (result.count ?? 0) === ids.length }
  }
  return { fixturePrefix: FIXTURE_PREFIX, counts, violations }
}

if ((await import('./fixture-runtime.mjs')).isMain(import.meta.url, process.argv[1])) {
  const { authClient, readCatalog } = await import('./fixture-runtime.mjs')
  const { client } = await authClient()
  const result = await validateFixture(client, await readCatalog())
  console.log(JSON.stringify(result, null, 2))
  if (result.violations.length || Object.values(result.counts).some((count) => count.matches === false)) process.exitCode = 1
}
