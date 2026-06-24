import type { DemurrageInvoice } from '../../types/database'

// Sob recálculo diário não há 'draft' nem 'overdue' (ADR 0014): a fatura nasce
// 'issued'. A aba "Emitidas" passa a se chamar "Faturas".
export const DEMURRAGE_INVOICE_TABS: Array<{
  key: 'emitidas' | 'pagas' | 'canceladas'
  label: string
  status: NonNullable<DemurrageInvoice['status']>
}> = [
  { key: 'emitidas', label: 'Faturas', status: 'issued' },
  { key: 'pagas', label: 'Pagas', status: 'paid' },
  { key: 'canceladas', label: 'Canceladas', status: 'cancelled' },
]
