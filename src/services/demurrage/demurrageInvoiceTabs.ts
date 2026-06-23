import type { DemurrageInvoice } from '../../types/database'

export const DEMURRAGE_INVOICE_TABS: Array<{
  key: 'rascunhos' | 'emitidas' | 'vencidas' | 'pagas' | 'canceladas'
  label: string
  status: NonNullable<DemurrageInvoice['status']>
}> = [
  { key: 'rascunhos', label: 'Rascunhos', status: 'draft' },
  { key: 'emitidas', label: 'Emitidas', status: 'issued' },
  { key: 'vencidas', label: 'Vencidas', status: 'overdue' },
  { key: 'pagas', label: 'Pagas', status: 'paid' },
  { key: 'canceladas', label: 'Canceladas', status: 'cancelled' },
]
