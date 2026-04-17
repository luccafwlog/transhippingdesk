import { z } from 'zod'

export const DEFAULT_CARRIER_NAME = 'Cosco Shipping Specialized Carriers'
export const DEFAULT_CARRIER_SCAC = 'CSSC'

export type VoyageFormValues = {
  carrierName: string
  carrierScac: string
  vesselName: string
  vesselImo: string
  voyageNumber: string
  status: 'active' | 'completed' | 'cancelled'
}

export const initialVoyageFormValues: VoyageFormValues = {
  carrierName: DEFAULT_CARRIER_NAME,
  carrierScac: DEFAULT_CARRIER_SCAC,
  vesselName: '',
  vesselImo: '',
  voyageNumber: '',
  status: 'active',
}

export const voyageFormSchema = z.object({
  carrierName: z.string().min(2, 'Armador obrigatório (mín. 2 caracteres)'),
  carrierScac: z.string(),
  vesselName: z.string().min(2, 'Navio obrigatório (mín. 2 caracteres)'),
  vesselImo: z.string(),
  voyageNumber: z.string().min(1, 'Número da viagem obrigatório'),
  status: z.enum(['active', 'completed', 'cancelled']),
})

export type VoyageFormErrors = Partial<Record<keyof VoyageFormValues, string>>
