export type OpsFilters = {
  search: string
  cargoMode: '' | 'container' | 'carga_solta' | 'granito'
  pod: string
  voyageId: string
  chargeStatus: '' | 'review_required' | 'ready_for_billing' | 'exempt'
}

export type PipelineStep = 'reconciliation' | 'review' | 'ready_for_billing'

export type BatchOperation = 'recalculate' | 'review' | 'ready'
