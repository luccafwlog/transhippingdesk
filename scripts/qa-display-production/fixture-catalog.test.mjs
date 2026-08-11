import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

test('rejects the legacy committed artifact until phase 6 rewrites missing financial ids', async () => {
  const { normalizeCatalog } = await import('./fixture-catalog.mjs')
  const artifact = JSON.parse(await fs.readFile(new URL('../../artifacts/qa-display-production/operational-fixture.json', import.meta.url)))
  assert.throws(() => normalizeCatalog(artifact), /missing id/)
})

test('normalizes every supported key in a complete catalog', async () => {
  const { normalizeCatalog } = await import('./fixture-catalog.mjs')
  const entries = normalizeCatalog({
    prefix: 'QA-DISPLAY-2026', customers: [{ id: 1 }], voyages: [{ id: 2 }], vessels: [{ id: 3 }],
    bls: [{ id: 'QAD26-BL-001', container_id: 4 }], vehicles: [{ id: 5 }],
    granite: [{ id: 'a8bcee21-18e1-4a13-a2fe-ed46a80bb3ae' }], bl_containers: [{ id: 4 }],
    emptyContainers: { operation_id: 'f3a8a71f-a328-40ef-bfe1-91c9bccb5ede', manifest_id: 'bd74c8f9-f33e-429e-8032-f323951ac3a5' },
    demurrage: { doc_number: 'QAD26-DEM-001' }, localInvoice: { invoice_id: 6 }, syntheticPayment: { payment_id: 7 },
    portalAccounts: [{ account: { id: 8 } }], invoices: [{ id: 9 }], receivables: [{ id: 10 }],
  })
  assert.ok(entries.some((entry) => entry.table === 'bls'))
  assert.ok(entries.some((entry) => entry.table === 'bl_containers'))
  assert.ok(entries.some((entry) => entry.table === 'granite_bls'))
  assert.ok(entries.some((entry) => entry.table === 'vazios_export_operations'))
  assert.ok(entries.some((entry) => entry.table === 'vazios_bookings'))
})

test('fails closed for an unknown catalog key', async () => {
  const { assertCatalogShape } = await import('./fixture-catalog.mjs')
  assert.throws(() => assertCatalogShape({ prefix: 'QA-DISPLAY-2026', invented: [] }), /unknown fixture catalog key/)
})

test('preserves protected catalog entries so validate can report them', async () => {
  const { normalizeCatalog } = await import('./fixture-catalog.mjs')
  assert.deepEqual(normalizeCatalog({ prefix: 'QA-DISPLAY-2026', protected: [{ table: 'charge_tables', id: 'QAD26-CHARGE-1' }] }), [{ table: 'charge_tables', column: 'id', id: 'QAD26-CHARGE-1' }])
})
