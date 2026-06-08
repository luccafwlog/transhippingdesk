import { z } from 'zod'

export const DEFAULT_CARRIER_NAME = 'Cosco Shipping Specialized Carriers'
export const DEFAULT_CARRIER_SCAC = 'CSSC'

type VoyageDischargePortEta = {
  pod: string
  eta: string
}

export type VoyageFormValues = {
  carrierName: string
  carrierScac: string
  vesselName: string
  vesselImo: string
  voyageNumber: string
  status: 'active' | 'completed' | 'cancelled'
  dischargePortEtas: VoyageDischargePortEta[]
}

export const initialVoyageFormValues: VoyageFormValues = {
  carrierName: DEFAULT_CARRIER_NAME,
  carrierScac: DEFAULT_CARRIER_SCAC,
  vesselName: '',
  vesselImo: '',
  voyageNumber: '',
  status: 'active',
  dischargePortEtas: [],
}

export const voyageFormSchema = z.object({
  carrierName: z.string().min(2, 'Armador obrigatorio (min. 2 caracteres)'),
  carrierScac: z.string(),
  vesselName: z.string().min(2, 'Navio obrigatorio (min. 2 caracteres)'),
  vesselImo: z.string(),
  voyageNumber: z.string().min(1, 'Numero da viagem obrigatorio'),
  status: z.enum(['active', 'completed', 'cancelled']),
  dischargePortEtas: z.array(
    z.object({
      pod: z.string().min(1, 'Informe o porto de descarga'),
      eta: z.string().min(1, 'Informe o ETA do porto de descarga'),
    }),
  ),
})

export type VoyageFormErrors = Partial<Record<keyof VoyageFormValues, string>>

export function normalizeVoyageFormValues(values: VoyageFormValues): VoyageFormValues {
  return {
    ...values,
    carrierName: values.carrierName.trim(),
    carrierScac: values.carrierScac.trim().toUpperCase(),
    vesselName: values.vesselName.trim().toUpperCase(),
    vesselImo: values.vesselImo.trim(),
    voyageNumber: values.voyageNumber.trim().toUpperCase(),
    dischargePortEtas: normalizeDischargePortEtas(values.dischargePortEtas),
  }
}

function normalizeDischargePortEtas(values: VoyageDischargePortEta[]) {
  const normalized = new Map<string, VoyageDischargePortEta>()

  for (const value of values) {
    const pod = value.pod.trim().toUpperCase()
    const eta = value.eta.trim()

    if (!pod && !eta) continue

    normalized.set(pod || `__EMPTY__${normalized.size}`, { pod, eta })
  }

  return Array.from(normalized.values())
}
