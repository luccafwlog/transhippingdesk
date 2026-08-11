const SHAPES = Object.freeze({
  prefix: 'string',
  createdBy: 'string',
  userId: 'string',
  createdAt: 'string',
  customers: 'array',
  voyages: 'array',
  vessels: 'array',
  bls: 'array',
  bl_containers: 'array',
  vehicles: 'array',
  granite: 'array',
  emptyContainers: 'object',
  demurrage: 'object',
  localInvoice: 'object',
  syntheticPayment: 'object',
  portalAccounts: 'array',
  payments: 'array',
  portalEvents: 'array',
  adr: 'object',
  invoices: 'array',
  receivables: 'array',
  protected: 'array',
})

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function ensureId(value, path) {
  if (value === undefined || value === null || value === '') throw new Error(`missing id at ${path}`)
  return value
}

export function assertCatalogShape(catalog) {
  if (!isObject(catalog)) throw new Error('fixture catalog must be an object')
  for (const [key, value] of Object.entries(catalog)) {
    const shape = SHAPES[key]
    if (!shape) throw new Error(`unknown fixture catalog key: ${key}`)
    if (shape === 'array' && !Array.isArray(value)) throw new Error(`fixture catalog key ${key} must be an array`)
    if (shape === 'object' && !isObject(value)) throw new Error(`fixture catalog key ${key} must be an object`)
    if (shape === 'string' && typeof value !== 'string') throw new Error(`fixture catalog key ${key} must be a string`)
  }
  if (catalog.prefix !== undefined && typeof catalog.prefix !== 'string') throw new Error('fixture catalog prefix must be a string')
  return true
}

function push(entries, table, column, value, path, source) {
  entries.push({ table, column, id: ensureId(value, path), ...(source?.created !== undefined ? { created: source.created } : {}) })
}

export function normalizeCatalog(catalog) {
  assertCatalogShape(catalog)
  const entries = []
  for (const item of catalog.customers ?? []) push(entries, 'customers', 'id', item.id, 'customers[].id', item)
  for (const item of catalog.voyages ?? []) push(entries, 'voyages', 'id', item.id, 'voyages[].id', item)
  for (const item of catalog.vessels ?? []) push(entries, 'vessels', 'id', item.id, 'vessels[].id', item)
  for (const item of catalog.bls ?? []) {
    push(entries, 'bls', 'id', item.id, 'bls[].id', item)
    if (item.container_id !== undefined) push(entries, 'bl_containers', 'id', item.container_id, 'bls[].container_id', item)
  }
  for (const item of catalog.bl_containers ?? []) push(entries, 'bl_containers', 'id', item.id, 'bl_containers[].id', item)
  for (const item of catalog.vehicles ?? []) push(entries, 'vehicles', 'id', item.id, 'vehicles[].id', item)
  for (const item of catalog.granite ?? []) push(entries, 'granite_bls', 'id', item.id, 'granite[].id', item)
  for (const item of catalog.portalAccounts ?? []) push(entries, 'customer_portal_accounts', 'id', item.account?.id ?? item.id, 'portalAccounts[].account.id', item)
  for (const item of catalog.invoices ?? []) push(entries, 'invoices', 'id', item.id, 'invoices[].id', item)
  for (const item of catalog.payments ?? []) push(entries, 'payments', 'id', item.id, 'payments[].id', item)
  for (const item of catalog.portalEvents ?? []) push(entries, 'portal_provisioning_events', 'id', item.id, 'portalEvents[].id', item)
  for (const item of catalog.receivables ?? []) push(entries, 'bl_receivables', 'id', item.id ?? item, 'receivables[].id', typeof item === 'object' ? item : undefined)
  for (const item of catalog.protected ?? []) {
    if (!isObject(item) || !item.table) throw new Error('protected[] must contain table and id')
    push(entries, item.table, item.column ?? 'id', item.id, 'protected[].id', item)
  }
  if (catalog.emptyContainers) {
    if (catalog.emptyContainers.operation_id !== undefined) push(entries, 'vazios_export_operations', 'id', catalog.emptyContainers.operation_id, 'emptyContainers.operation_id', catalog.emptyContainers)
    if (catalog.emptyContainers.manifest_id !== undefined) push(entries, 'vazios_bookings', 'manifest_id', catalog.emptyContainers.manifest_id, 'emptyContainers.manifest_id', catalog.emptyContainers)
  }
  if (catalog.demurrage) push(entries, 'demurrage_invoices', catalog.demurrage.id !== undefined ? 'id' : 'doc_number', catalog.demurrage.id ?? catalog.demurrage.doc_number, 'demurrage.id/doc_number', catalog.demurrage)
  if (catalog.localInvoice) push(entries, 'invoices', catalog.localInvoice.id !== undefined ? 'id' : 'invoice_id', catalog.localInvoice.id ?? catalog.localInvoice.invoice_id, 'localInvoice.id/invoice_id', catalog.localInvoice)
  if (catalog.syntheticPayment) push(entries, 'payments', catalog.syntheticPayment.id !== undefined ? 'id' : 'payment_id', catalog.syntheticPayment.id ?? catalog.syntheticPayment.payment_id, 'syntheticPayment.id/payment_id', catalog.syntheticPayment)
  if (catalog.adr) {
    if (catalog.adr.omissionId !== undefined) push(entries, 'voyage_omissions', 'id', catalog.adr.omissionId, 'adr.omissionId', catalog.adr)
    if (catalog.adr.transshipmentId !== undefined) push(entries, 'bl_transshipments', 'id', catalog.adr.transshipmentId, 'adr.transshipmentId', catalog.adr)
    if (catalog.adr.codId !== undefined) push(entries, 'bl_transshipments', 'id', catalog.adr.codId, 'adr.codId', catalog.adr)
  }
  return entries
}

export function requireIds(catalog, path) {
  const value = catalog?.[path]
  if (!Array.isArray(value) || value.length === 0) throw new Error(`fixture catalog requires non-empty ${path}`)
  return value.map((item, index) => ensureId(item?.id ?? item, `${path}[${index}]`))
}

export const CATALOG_KEYS = Object.freeze(Object.keys(SHAPES))
