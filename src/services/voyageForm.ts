export const DEFAULT_CARRIER_NAME = 'Cosco Shipping Specialized Carriers'
export const DEFAULT_CARRIER_SCAC = 'CSSC'

export type VoyageFormValues = {
  carrierName: string
  carrierScac: string
  vesselName: string
  vesselImo: string
  voyageNumber: string
  etd: string
  eta: string
  status: 'active' | 'completed' | 'cancelled'
}

export const initialVoyageFormValues: VoyageFormValues = {
  carrierName: DEFAULT_CARRIER_NAME,
  carrierScac: DEFAULT_CARRIER_SCAC,
  vesselName: '',
  vesselImo: '',
  voyageNumber: '',
  etd: '',
  eta: '',
  status: 'active',
}
