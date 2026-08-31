export type CustomerDemurrageAgreement = {
  id: number
  customer_id: number
  free_days: number
  p1_usd: number | null
  p2_usd: number | null
  valid_from: string
  valid_to: string | null
  active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export type CustomerDemurrageAgreementListItem = CustomerDemurrageAgreement & {
  customer?: {
    id: number
    name: string
    cnpj_cpf: string
  } | null
}

export type CustomerDemurrageAgreementFormInput = {
  id?: number
  customer_id: number
  free_days: number
  p1_usd?: number | null
  p2_usd?: number | null
  valid_from: string
  valid_to?: string | null
  active?: boolean
  notes?: string | null
}

export type CustomerAgreementRates = {
  free_days?: number | null
  p1_usd?: number | null
  p2_usd?: number | null
} | null
