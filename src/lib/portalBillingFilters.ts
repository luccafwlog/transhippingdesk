import type { PortalStatusFilter } from './portalInvoiceStatus'

export type PortalBillingFilters = {
  status: PortalStatusFilter
  vessel: string
  bl: string
  pod: string
  dateFrom: string
  dateTo: string
}

export const EMPTY_PORTAL_BILLING_FILTERS: PortalBillingFilters = {
  status: '',
  vessel: '',
  bl: '',
  pod: '',
  dateFrom: '',
  dateTo: '',
}
