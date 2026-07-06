import type { DemurrageInvoice } from '../../types/database'

export type DiscountForm = {
  discount_type: DemurrageInvoice['discount_type']
  discount_value: string
  discount_mode: 'percent' | 'fixed'
  discount_justification: string
  discount_approver: string
}

export type DisputeForm = {
  dispute_open: boolean
  dispute_subject: string
  dispute_reason: string
  dispute_status: DemurrageInvoice['dispute_status']
  dispute_notes: string
}

export const DISCOUNT_TYPE_LABELS: Record<NonNullable<DemurrageInvoice['discount_type']>, string> = {
  comercial: 'Comercial',
  datas: 'Datas',
  cortesia: 'Cortesia',
  acordo: 'Acordo',
  erro: 'Erro',
}

export const DISPUTE_STATUS_LABELS: Record<NonNullable<DemurrageInvoice['dispute_status']>, string> = {
  aberto: 'Aberto',
  resolvido: 'Resolvido',
  cancelado: 'Cancelado',
}

export const EMPTY_DISCOUNT: DiscountForm = {
  discount_type: null,
  discount_value: '',
  discount_mode: 'percent',
  discount_justification: '',
  discount_approver: '',
}

export const EMPTY_DISPUTE: DisputeForm = {
  dispute_open: false,
  dispute_subject: '',
  dispute_reason: '',
  dispute_status: null,
  dispute_notes: '',
}
