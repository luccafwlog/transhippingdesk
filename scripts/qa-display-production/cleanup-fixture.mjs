import { FIXTURE_CODE, FIXTURE_PREFIX, PROTECTED_TABLES, assertFixtureConfig } from './fixture-config.mjs'

const ORDER = [
  ['portal_notifications', 'id'], ['portal_provisioning_events', 'id'], ['ledger_settlements', 'id'],
  ['payments', 'id'], ['invoice_receivable_links', 'id'], ['invoices', 'id'],
  ['demurrage_invoice_items', 'id'], ['demurrage_invoices', 'id'], ['bl_transshipments', 'id'],
  ['voyage_omissions', 'id'], ['vehicles', 'id'], ['bl_containers', 'id'], ['granite_bls', 'id'],
  ['bls', 'id'], ['vazios_importacao_containers', 'id'], ['vazios_bookings', 'id'],
  ['vazios_export_operations', 'id'], ['voyage_scales', 'id'], ['audit_logs', 'id'],
  ['customer_portal_accounts', 'id'], ['voyages', 'id'], ['vessels', 'id'], ['customers', 'id'],
]

const isSyntheticId = (value) => typeof value !== 'string' || value.startsWith(FIXTURE_PREFIX) || value.startsWith(FIXTURE_CODE)

function catalogEntries(catalog) {
  return Object.entries(catalog).flatMap(([key, value]) => {
    if (!Array.isArray(value)) return []
    return value.filter((item) => item && typeof item === 'object' && 'id' in item).map((item) => ({ key, ...item }))
  })
}

export function assertCleanupCatalog(catalog) {
  assertFixtureConfig()
  if (!catalog || catalog.prefix !== FIXTURE_PREFIX) throw new Error('fixture catalog prefix mismatch')
  const entries = catalogEntries(catalog)
  if (!entries.length) throw new Error('fixture catalog is empty')
  for (const entry of entries) {
    if (!isSyntheticId(entry.id)) throw new Error(`identifier is outside fixture: ${entry.id}`)
  }
  return entries
}

function buildOperations(catalog) {
  const entries = catalogEntries(catalog)
  return ORDER.flatMap(([table, column]) => {
    const ids = entries.filter((entry) => entry.table === table || entry.key === table).map((entry) => entry.id)
    return ids.length ? [{ table, column, ids }] : []
  })
}

export async function cleanupFixture(client, catalog, { dryRun = true } = {}) {
  const entries = assertCleanupCatalog(catalog)
  const operations = buildOperations(catalog)
  if (!dryRun && entries.some((entry) => entry.created !== true)) {
    throw new Error('destructive cleanup requires created:true for every catalog entry')
  }
  if (operations.some((operation) => PROTECTED_TABLES.includes(operation.table))) {
    throw new Error('cleanup plan contains a protected table')
  }
  if (dryRun) return { dryRun: true, operations }
  for (const operation of operations) {
    const query = client.from(operation.table).delete().in(operation.column, operation.ids)
    if (query?.then) await query
  }
  return { dryRun: false, operations }
}
