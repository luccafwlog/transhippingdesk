export function isCustomerReconciliationResolved(status: string | null | undefined) {
  return status === 'matched_document' || status === 'reconciled'
}
