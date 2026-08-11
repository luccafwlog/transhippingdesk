import test from 'node:test'
import assert from 'node:assert/strict'
import { createContractClient } from './fake-contract-client.mjs'

test('enforces RPC contracts used by fixture producers', async () => {
  const client = createContractClient({ bls: [{ id: 'QAD26-BL-001', customer_id: 7, financial_status: 'invoiced' }] })
  await assert.rejects(() => client.rpc('register_ledger_invoice_payment', { p_invoice_id: 1, p_amount_brl: 99, p_source: 'pix_extract' }), /invoice not found/)
  await assert.rejects(() => client.rpc('create_invoice_from_bls_with_ledger', { p_bl_ids: ['QAD26-BL-001'], p_customer_id: 7 }), /not ready/)
  await assert.rejects(() => client.rpc('create_local_consolidated_invoice', { p_receivable_ids: [] }), /receivable/)
  await assert.rejects(() => client.rpc('create_demurrage_invoice_with_items', { p_items: [] }), /item/)
  await assert.rejects(() => client.rpc('set_bl_cod', { p_bl_id: 'QAD26-BL-001' }), /transbordo/)
})

test('rejects wrong owner and non-exact PIX before mutating state', async () => {
  const client = createContractClient({ bls: [{ id: 'QAD26-BL-002', customer_id: 9 }], invoices: [{ id: 42, balance: 100 }] })
  await assert.rejects(() => client.rpc('create_invoice_from_bls_with_ledger', { p_bl_ids: ['QAD26-BL-002'], p_customer_id: 8 }), /nao corresponde/)
  await assert.rejects(() => client.rpc('register_ledger_invoice_payment', { p_invoice_id: 42, p_amount_brl: 99, p_source: 'pix_extract' }), /exatamente/)
  assert.equal(client.state.mutations, 0)
})
