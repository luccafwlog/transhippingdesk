type LedgerInvoicePaymentCandidate = {
  invoice_type?: string | null
  status?: string | null
  balance_brl?: number | string | null
}

export function isLedgerInvoicePayable(invoice: LedgerInvoicePaymentCandidate | null | undefined) {
  if (!invoice) return false
  const isLocalLedgerInvoice = invoice.invoice_type === 'individual' || invoice.invoice_type === 'consolidated'
  const isPayableStatus = invoice.status === 'issued' || invoice.status === 'partially_paid' || invoice.status === 'overdue'
  return isLocalLedgerInvoice && isPayableStatus && Number(invoice.balance_brl ?? 0) > 0
}
