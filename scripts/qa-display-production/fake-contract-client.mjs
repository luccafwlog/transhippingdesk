export function createContractClient({ bls = [], invoices = [], transshipments = [] } = {}) {
  const state = {
    bls: new Map(bls.map((bl) => [bl.id, { financial_status: 'pending', ...bl }])),
    invoices: new Map(invoices.map((invoice) => [invoice.id, { balance: invoice.balance ?? 100, customer_id: invoice.customer_id }])),
    transshipments: new Set(transshipments),
    mutations: 0,
    sequence: 1000,
  }
  const rpc = async (name, payload) => {
    if (name === 'create_invoice_from_bls_with_ledger') {
      const bl = state.bls.get(payload.p_bl_ids?.[0])
      if (!bl || !['pending', 'ready_for_billing'].includes(bl.financial_status)) throw new Error('B/L is not ready for billing')
      if (payload.p_customer_id !== bl.customer_id) throw new Error('Cliente informado nao corresponde')
      const id = state.sequence++
      state.invoices.set(id, { balance: 100, customer_id: bl.customer_id })
      state.mutations++
      return { data: { invoice_id: id, balance_due: 100 }, error: null }
    }
    if (name === 'register_ledger_invoice_payment') {
      const invoice = state.invoices.get(payload.p_invoice_id)
      if (!invoice) throw new Error('invoice not found')
      if (payload.p_source === 'pix_extract' && Math.abs(payload.p_amount_brl - invoice.balance) > 0.01) throw new Error('PIX deve ser exatamente o saldo aberto')
      invoice.balance -= payload.p_amount_brl
      state.mutations++
      return { data: { payment_id: state.sequence++ }, error: null }
    }
    if (name === 'create_demurrage_invoice_with_items') {
      if (!Array.isArray(payload.p_items) || payload.p_items.length === 0) throw new Error('Nenhum item de Demurrage informado')
      state.mutations++
    }
    if (name === 'create_local_consolidated_invoice') {
      if (!Array.isArray(payload.p_receivable_ids) || payload.p_receivable_ids.length === 0) throw new Error('Nenhum receivable informado para consolidar')
      state.mutations++
    }
    if (name === 'set_bl_cod' && !state.transshipments.has(payload.p_bl_id)) throw new Error('P0002: B/L sem transbordo')
    if (name === 'set_bl_cod' || name === 'set_bl_transshipment' || name === 'omit_voyage_escala') state.mutations++
    return { data: { id: state.sequence++ }, error: null }
  }
  return { rpc, state }
}
