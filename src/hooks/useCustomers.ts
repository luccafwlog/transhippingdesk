import { useQuery } from '@tanstack/react-query'
import { supabase } from '../services/supabase'
import { fetchIssuedInvoiceBalanceByCustomer } from '../services/customers'
import { escapeFilterTerm, onlyDigits } from '../lib/utils'
import { sortCustomerRows, type CustomerSortKey, type SortDirection } from '../lib/customerTableViewModel'
import type { Customer, CustomerDetail, CustomerListItem } from '../types/database'

export type CustomerFilters = {
  search: string
  contactEmail: string
  emailStatus: '' | 'with' | 'without'
  blStatus: '' | 'with' | 'without'
  pendingStatus: '' | 'with' | 'without'
  sortKey: CustomerSortKey
  sortDirection: SortDirection
  page: number
  pageSize: number
}

type CustomerSummary = {
  totalCustomers: number
  pendingBalance: number
  totalBls: number
  chargePending: number
  chargeReady: number
}

export function summarizeCustomerRows(rows: CustomerListItem[]): CustomerSummary {
  const bls = rows.flatMap((row) => row.bls ?? [])

  return {
    totalCustomers: rows.length,
    pendingBalance: rows.reduce((sum, row) => sum + Number(row.pending_balance ?? 0), 0),
    totalBls: bls.length,
    chargePending: bls.filter((bl) => bl.charge_status === 'review_required' || bl.charge_status === 'not_calculated').length,
    chargeReady: bls.filter((bl) => bl.charge_status === 'ready_for_billing').length,
  }
}

function customerHasEmail(row: CustomerListItem) {
  return (row.customer_contacts ?? []).some((contact) => String(contact.email ?? '').trim().length > 0)
}

export function filterCustomerRowsByClientSideFilters(rows: CustomerListItem[], filters: CustomerFilters) {
  const contactEmail = filters.contactEmail.trim().toLowerCase()

  return rows.filter((row) => {
    const hasEmails = customerHasEmail(row)
    const hasBls = (row.bls?.length ?? 0) > 0
    const hasPendingBalance = Number(row.pending_balance ?? 0) > 0

    if (contactEmail) {
      const matchesContactEmail = (row.customer_contacts ?? []).some((contact) =>
        String(contact.email ?? '').toLowerCase().includes(contactEmail),
      )
      if (!matchesContactEmail) return false
    }
    if (filters.emailStatus === 'with' && !hasEmails) return false
    if (filters.emailStatus === 'without' && hasEmails) return false
    if (filters.blStatus === 'with' && !hasBls) return false
    if (filters.blStatus === 'without' && hasBls) return false
    if (filters.pendingStatus === 'with' && !hasPendingBalance) return false
    if (filters.pendingStatus === 'without' && hasPendingBalance) return false
    return true
  })
}

export function useCustomerSummary(filters: CustomerFilters) {
  return useQuery({
    queryKey: ['customers-summary', filters],
    queryFn: async () => {
      const result = await fetchCustomerRows(filters, false)
      return summarizeCustomerRows(result.rows)
    },
    staleTime: 60_000,
  })
}

export function useCustomers(filters: CustomerFilters) {
  return useQuery({
    queryKey: ['customers', filters],
    queryFn: () => fetchCustomerRows(filters, true),
  })
}

export async function fetchCustomerRows(filters: CustomerFilters, paginate: boolean) {
  const from = filters.page * filters.pageSize
  const to = from + filters.pageSize - 1

  // Ordenacao por B/Ls e saldo depende de dados agregados/calculados no cliente,
  // entao qualquer ordenacao fora de "nome ascendente" exige varrer tudo antes de paginar.
  const needsClientSideSort = filters.sortKey !== 'name' || filters.sortDirection !== 'asc'

  const hasClientSideFilter =
    Boolean(filters.contactEmail.trim()) ||
    Boolean(filters.emailStatus) ||
    filters.blStatus === 'without' ||
    Boolean(filters.pendingStatus) ||
    needsClientSideSort

  const blsJoin = filters.blStatus === 'with' ? 'bls!inner(id, charge_status)' : 'bls(id, charge_status)'

  let query = supabase
    .from('customers')
    .select(`*, ${blsJoin}, customer_contacts(id, email, purpose, is_primary)`, { count: 'exact' })
    .order('name', { ascending: true })

  if (paginate && !hasClientSideFilter) {
    query = query.range(from, to)
  }

  if (filters.search) {
    const search = escapeFilterTerm(filters.search)
    const normalizedDocument = onlyDigits(filters.search)
    const documentClause = normalizedDocument ? `,cnpj_cpf.ilike.%${normalizedDocument}%` : ''
    const terms = search
      ? `name.ilike.%${search}%,trade_name.ilike.%${search}%,cnpj_cpf.ilike.%${search}%`
      : ''
    const filter = [terms, documentClause.slice(1)].filter(Boolean).join(',')
    if (filter) query = query.or(filter)
  }

  const { data, error, count } = await query
  if (error) throw error

  let rows = (data ?? []) as unknown as CustomerListItem[]
  const balances = await fetchIssuedInvoiceBalanceByCustomer(rows.map((row) => row.id))
  rows = rows.map((row) => ({ ...row, pending_balance: balances.get(row.id) ?? 0 }))
  rows = filterCustomerRowsByClientSideFilters(rows, filters)
  rows = sortCustomerRows(rows, filters.sortKey, filters.sortDirection)

  if (!paginate) {
    return {
      rows,
      count: rows.length,
      totalCount: rows.length,
    }
  }

  if (hasClientSideFilter) {
    const paginatedRows = rows.slice(from, from + filters.pageSize)
    return {
      rows: paginatedRows,
      count: paginatedRows.length,
      totalCount: rows.length,
    }
  }

  return {
    rows,
    count: rows.length,
    totalCount: count ?? 0,
  }
}

export function useCustomerDetail(cnpj?: string) {
  return useQuery({
    queryKey: ['customer-detail', cnpj],
    enabled: Boolean(cnpj),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select(
          `
          *,
          customer_contacts(*),
          bls(id, consignee, financial_status, review_status, created_at)
        `,
        )
        .eq('cnpj_cpf', cnpj!)
        .single()

      if (error) throw error

      const customer = data as unknown as CustomerDetail

      const { data: invoices, error: invoiceError } = await supabase
        .from('invoices')
        .select('id, invoice_number, issued_at, due_date, total_brl, balance_brl, status')
        .eq('customer_id', customer.id)
        .order('issued_at', { ascending: false })
        .range(0, 199)

      if (invoiceError) {
        if (isPermissionError(invoiceError)) {
          return {
            ...customer,
            pending_balance: 0,
            invoices: [],
            invoices_access_denied: true,
          } as CustomerDetail
        }
        throw invoiceError
      }

      const pendingBalance = (invoices ?? [])
        .filter((invoice) => invoice.status === 'issued')
        .reduce((sum, invoice) => sum + Number(invoice.balance_brl ?? 0), 0)

      return {
        ...customer,
        pending_balance: pendingBalance,
        invoices: (invoices ?? []) as CustomerDetail['invoices'],
        invoices_access_denied: false,
      } as CustomerDetail
    },
  })
}

function isPermissionError(error: { code?: string | null; message?: string | null }) {
  return error.code === '42501' || String(error.message ?? '').toLowerCase().includes('permission denied')
}

export function useCustomerLookup(search: string) {
  const filter = buildCustomerLookupFilter(search)
  return useQuery({
    queryKey: ['customer-lookup', search],
    enabled: Boolean(filter),
    queryFn: () => fetchCustomerLookup(search),
  })
}

function buildCustomerLookupFilter(search: string) {
  const term = escapeFilterTerm(search)
  const document = onlyDigits(search)
  const clauses: string[] = []

  if (term.length >= 2) {
    clauses.push(`name.ilike.%${term}%`, `cnpj_cpf.ilike.%${term}%`)
  }
  if (document.length >= 2 && document !== term) {
    clauses.push(`cnpj_cpf.ilike.%${document}%`)
  }

  return clauses.join(',')
}

export async function fetchCustomerLookup(search: string) {
  const filter = buildCustomerLookupFilter(search)
  if (!filter) return []

  const { data, error } = await supabase
    .from('customers')
    .select('id, cnpj_cpf, name, city, state')
    .or(filter)
    .order('name', { ascending: true })
    .range(0, 24)

  if (error) throw error
  return (data ?? []) as Pick<Customer, 'id' | 'cnpj_cpf' | 'name' | 'city' | 'state'>[]
}
