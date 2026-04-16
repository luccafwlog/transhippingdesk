import { supabase } from './supabase'

const REPORT_ROW_LIMIT = 2000

export type ReportFilters = {
  dateFrom: string
  dateTo: string
}

export type OperationalReportFilters = ReportFilters & {
  pod: string
  cargoMode: '' | 'container' | 'carga_solta'
}

export type FinancialReportFilters = ReportFilters & {
  status: '' | 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled'
}

export type OperationalReportRow = {
  id: string
  pol: string | null
  pod: string | null
  cargo_mode: string | null
  review_status: string | null
  financial_status: string | null
  total_weight_kg: number | null
  total_cbm: number | null
  created_at: string | null
  voyage_id: number | null
  customer: { id: number; name: string; cnpj_cpf: string } | null
  voyage: {
    id: number
    voyage_number: string | null
    vessel: {
      id: number
      name: string | null
      carrier: { id: number; name: string | null } | null
    } | null
  } | null
  bl_containers: { id: number; container_number: string | null }[] | null
}

export type OperationalReportResult = {
  rows: OperationalReportRow[]
  kpis: {
    totalBls: number
    totalContainers: number
    totalWeightKg: number
    totalCbm: number
    totalVoyages: number
    truncated: boolean
  }
}

export async function fetchOperationalReport(filters: OperationalReportFilters): Promise<OperationalReportResult> {
  let query = supabase
    .from('bls')
    .select(
      `
      id, pol, pod, cargo_mode, review_status, financial_status,
      total_weight_kg, total_cbm, created_at, voyage_id,
      customer:customers(id, name, cnpj_cpf),
      voyage:voyages(id, voyage_number, vessel:vessels(id, name, carrier:carriers(id, name))),
      bl_containers(id, container_number)
    `,
    )
    .order('created_at', { ascending: false })
    .limit(REPORT_ROW_LIMIT)

  if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom)
  if (filters.dateTo) query = query.lte('created_at', `${filters.dateTo}T23:59:59`)
  if (filters.pod) query = query.eq('pod', filters.pod.toUpperCase())
  if (filters.cargoMode) query = query.eq('cargo_mode', filters.cargoMode)

  const { data, error } = await query
  if (error) throw error

  const rows = ((data ?? []) as unknown as OperationalReportRow[])

  const distinctContainers = new Set<string>()
  for (const row of rows) {
    for (const container of row.bl_containers ?? []) {
      if (container.container_number) distinctContainers.add(container.container_number)
    }
  }

  const distinctVoyages = new Set<number>()
  for (const row of rows) {
    if (row.voyage_id != null) distinctVoyages.add(row.voyage_id)
  }

  const kpis = {
    totalBls: rows.length,
    totalContainers: distinctContainers.size,
    totalWeightKg: rows.reduce((sum, row) => sum + Number(row.total_weight_kg ?? 0), 0),
    totalCbm: rows.reduce((sum, row) => sum + Number(row.total_cbm ?? 0), 0),
    totalVoyages: distinctVoyages.size,
    truncated: rows.length === REPORT_ROW_LIMIT,
  }

  return { rows, kpis }
}

export type FinancialReportRow = {
  id: number
  invoice_number: string | null
  status: string | null
  total_brl: number | null
  balance_brl: number | null
  issued_at: string | null
  due_date: string | null
  created_at: string | null
  customer: { id: number; name: string; cnpj_cpf: string } | null
}

export type FinancialReportResult = {
  rows: FinancialReportRow[]
  kpis: {
    totalInvoices: number
    totalIssued: number
    totalPaid: number
    totalOpen: number
    totalCanceled: number
    truncated: boolean
  }
  accessDenied: boolean
}

export async function fetchFinancialReport(filters: FinancialReportFilters): Promise<FinancialReportResult> {
  let query = supabase
    .from('invoices')
    .select(
      `
      id, invoice_number, status, total_brl, balance_brl, issued_at, due_date, created_at,
      customer:customers(id, name, cnpj_cpf)
    `,
    )
    .order('issued_at', { ascending: false, nullsFirst: false })
    .limit(REPORT_ROW_LIMIT)

  if (filters.dateFrom) query = query.gte('issued_at', filters.dateFrom)
  if (filters.dateTo) query = query.lte('issued_at', filters.dateTo)
  if (filters.status) query = query.eq('status', filters.status)

  const { data, error } = await query
  if (error) {
    if (error.code === '42501' || error.code === 'PGRST301') {
      return {
        rows: [],
        kpis: { totalInvoices: 0, totalIssued: 0, totalPaid: 0, totalOpen: 0, totalCanceled: 0, truncated: false },
        accessDenied: true,
      }
    }
    throw error
  }

  const rows = ((data ?? []) as unknown as FinancialReportRow[])

  const isOpen = (status: string | null) =>
    status === 'issued' || status === 'partially_paid' || status === 'overdue'

  const kpis = {
    totalInvoices: rows.length,
    totalIssued: rows
      .filter((row) => row.status !== 'cancelled' && row.status !== 'draft')
      .reduce((sum, row) => sum + Number(row.total_brl ?? 0), 0),
    totalPaid: rows
      .filter((row) => row.status === 'paid')
      .reduce((sum, row) => sum + Number(row.total_brl ?? 0), 0),
    totalOpen: rows
      .filter((row) => isOpen(row.status))
      .reduce((sum, row) => sum + Number(row.balance_brl ?? 0), 0),
    totalCanceled: rows.filter((row) => row.status === 'cancelled').length,
    truncated: rows.length === REPORT_ROW_LIMIT,
  }

  return { rows, kpis, accessDenied: false }
}

export type CustomerReportRow = {
  customer_id: number
  name: string
  cnpj_cpf: string
  blCount: number
  totalWeightKg: number
  totalCbm: number
  invoiceCount: number
  totalIssued: number
  totalBalance: number
}

export type CustomerReportResult = {
  rows: CustomerReportRow[]
  kpis: {
    totalCustomers: number
    topByBls: string
    topByInvoiced: string
    totalIssued: number
    truncated: boolean
  }
  invoicesAccessDenied: boolean
}

export async function fetchCustomerReport(filters: ReportFilters): Promise<CustomerReportResult> {
  let blsQuery = supabase
    .from('bls')
    .select(
      `id, customer_id, total_weight_kg, total_cbm, created_at,
       customer:customers(id, name, cnpj_cpf)`,
    )
    .not('customer_id', 'is', null)
    .limit(REPORT_ROW_LIMIT * 2)

  if (filters.dateFrom) blsQuery = blsQuery.gte('created_at', filters.dateFrom)
  if (filters.dateTo) blsQuery = blsQuery.lte('created_at', `${filters.dateTo}T23:59:59`)

  const { data: blsData, error: blsError } = await blsQuery
  if (blsError) throw blsError

  type BlRow = {
    customer_id: number
    total_weight_kg: number | null
    total_cbm: number | null
    customer: { id: number; name: string; cnpj_cpf: string } | null
  }

  const bls = (blsData ?? []) as unknown as BlRow[]

  const perCustomer = new Map<number, CustomerReportRow>()
  for (const bl of bls) {
    if (bl.customer_id == null || !bl.customer) continue
    let entry = perCustomer.get(bl.customer_id)
    if (!entry) {
      entry = {
        customer_id: bl.customer_id,
        name: bl.customer.name,
        cnpj_cpf: bl.customer.cnpj_cpf,
        blCount: 0,
        totalWeightKg: 0,
        totalCbm: 0,
        invoiceCount: 0,
        totalIssued: 0,
        totalBalance: 0,
      }
      perCustomer.set(bl.customer_id, entry)
    }
    entry.blCount++
    entry.totalWeightKg += Number(bl.total_weight_kg ?? 0)
    entry.totalCbm += Number(bl.total_cbm ?? 0)
  }

  let invoicesAccessDenied = false
  let invoicesQuery = supabase
    .from('invoices')
    .select('customer_id, total_brl, balance_brl, status, issued_at')
    .not('customer_id', 'is', null)
    .limit(REPORT_ROW_LIMIT * 2)

  if (filters.dateFrom) invoicesQuery = invoicesQuery.gte('issued_at', filters.dateFrom)
  if (filters.dateTo) invoicesQuery = invoicesQuery.lte('issued_at', filters.dateTo)

  const { data: invoicesData, error: invoicesError } = await invoicesQuery
  if (invoicesError) {
    if (invoicesError.code === '42501' || invoicesError.code === 'PGRST301') {
      invoicesAccessDenied = true
    } else {
      throw invoicesError
    }
  }

  type InvoiceRow = {
    customer_id: number
    total_brl: number | null
    balance_brl: number | null
    status: string | null
  }

  const invoices = (invoicesData ?? []) as unknown as InvoiceRow[]
  for (const invoice of invoices) {
    if (invoice.customer_id == null) continue
    const entry = perCustomer.get(invoice.customer_id)
    if (!entry) continue
    if (invoice.status === 'cancelled') continue
    entry.invoiceCount++
    entry.totalIssued += Number(invoice.total_brl ?? 0)
    entry.totalBalance += Number(invoice.balance_brl ?? 0)
  }

  const rows = [...perCustomer.values()].sort((a, b) => {
    if (b.totalIssued !== a.totalIssued) return b.totalIssued - a.totalIssued
    return b.blCount - a.blCount
  })

  const topByBls = [...rows].sort((a, b) => b.blCount - a.blCount)[0]?.name ?? '-'
  const topByInvoiced = rows[0] && rows[0].totalIssued > 0 ? rows[0].name : '-'

  const kpis = {
    totalCustomers: rows.length,
    topByBls,
    topByInvoiced,
    totalIssued: rows.reduce((sum, row) => sum + row.totalIssued, 0),
    truncated: bls.length === REPORT_ROW_LIMIT * 2,
  }

  return { rows, kpis, invoicesAccessDenied }
}
