import { useQuery } from '@tanstack/react-query'
import { supabase } from '../services/supabase'
import { escapeFilterTerm, onlyDigits } from '../lib/utils'
import type { Customer, CustomerDetail, CustomerListItem } from '../types/database'

export type CustomerFilters = {
  search: string
  emailStatus: '' | 'with' | 'without'
  blStatus: '' | 'with' | 'without'
  pendingStatus: '' | 'with' | 'without'
  page: number
  pageSize: number
}

export function useCustomerSummary() {
  return useQuery({
    queryKey: ['customers-summary'],
    queryFn: async () => {
      // Query bls directly to avoid max_rows truncation from the customers join
      const [customersResult, blsResult] = await Promise.all([
        fetchAllCustomersPendingBalance(),
        fetchAllLinkedBls(),
      ])

      return {
        totalCustomers: customersResult.count,
        pendingBalance: customersResult.pendingBalance,
        totalBls: blsResult.length,
        chargePending: blsResult.filter(
          (bl) => bl.charge_status === 'review_required' || bl.charge_status === 'not_calculated',
        ).length,
        chargeReady: blsResult.filter((bl) => bl.charge_status === 'ready_for_billing').length,
      }
    },
    staleTime: 60_000,
  })
}

async function fetchAllLinkedBls(): Promise<Array<{ charge_status: string | null }>> {
  const pageSize = 1000
  const result: Array<{ charge_status: string | null }> = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('bls')
      .select('charge_status')
      .not('customer_id', 'is', null)
      .range(from, from + pageSize - 1)
    if (error) throw error
    result.push(...(data ?? []))
    if ((data ?? []).length < pageSize) break
    from += pageSize
  }
  return result
}

async function fetchAllCustomersPendingBalance(): Promise<{ count: number; pendingBalance: number }> {
  const pageSize = 1000
  let count = 0
  let pendingBalance = 0
  let from = 0
  while (true) {
    const { data, count: total, error } = await supabase
      .from('customers')
      .select('pending_balance', { count: 'exact' })
      .range(from, from + pageSize - 1)
    if (error) throw error
    if (from === 0) count = total ?? 0
    for (const row of data ?? []) pendingBalance += Number(row.pending_balance ?? 0)
    if ((data ?? []).length < pageSize) break
    from += pageSize
  }
  return { count, pendingBalance }
}

export function useCustomers(filters: CustomerFilters) {
  return useQuery({
    queryKey: ['customers', filters],
    queryFn: async () => {
      const from = filters.page * filters.pageSize
      const to = from + filters.pageSize - 1

      // For "without related records", PostgREST !inner can't help — fetch all and paginate manually
      const hasClientSideFilter = filters.emailStatus === 'without' || filters.blStatus === 'without'

      // Use !inner join to filter server-side when "with" is selected
      const contactsJoin =
        filters.emailStatus === 'with' ? 'customer_contacts!inner(id)' : 'customer_contacts(id)'
      const blsJoin =
        filters.blStatus === 'with' ? 'bls!inner(id, charge_status)' : 'bls(id, charge_status)'

      let query = supabase
        .from('customers')
        .select(`*, ${blsJoin}, ${contactsJoin}`, { count: 'exact' })
        .order('name', { ascending: true })

      if (!hasClientSideFilter) {
        query = query.range(from, to)
      }

      if (filters.search) {
        const normalizedDocument = onlyDigits(filters.search)
        const documentClause = normalizedDocument ? `,cnpj_cpf.ilike.%${normalizedDocument}%` : ''
        query = query.or(
          `name.ilike.%${filters.search}%,trade_name.ilike.%${filters.search}%,cnpj_cpf.ilike.%${filters.search}%${documentClause}`,
        )
      }

      if (filters.pendingStatus === 'with') {
        query = query.gt('pending_balance', 0)
      } else if (filters.pendingStatus === 'without') {
        query = query.or('pending_balance.eq.0,pending_balance.is.null')
      }

      const { data, error, count } = await query
      if (error) throw error

      let rows = (data ?? []) as unknown as CustomerListItem[]

      // Client-side filter only for "without" cases (absence of related records)
      if (filters.emailStatus === 'without') {
        rows = rows.filter((row) => (row.customer_contacts?.length ?? 0) === 0)
      }
      if (filters.blStatus === 'without') {
        rows = rows.filter((row) => (row.bls?.length ?? 0) === 0)
      }

      // When client-side filter is active all records are fetched; paginate manually
      let paginatedRows: CustomerListItem[]
      let totalCount: number
      if (hasClientSideFilter) {
        totalCount = rows.length
        paginatedRows = rows.slice(from, from + filters.pageSize)
      } else {
        totalCount = count ?? 0
        paginatedRows = rows
      }

      return {
        rows: paginatedRows,
        count: paginatedRows.length,
        totalCount,
      }
    },
  })
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
        .select('id, invoice_number, issued_at, due_date, total_brl, status')
        .eq('customer_id', customer.id)
        .order('issued_at', { ascending: false })
        .range(0, 199)

      if (invoiceError) {
        if (isPermissionError(invoiceError)) {
          return {
            ...customer,
            invoices: [],
            invoices_access_denied: true,
          } as CustomerDetail
        }
        throw invoiceError
      }

      return {
        ...customer,
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
  return useQuery({
    queryKey: ['customer-lookup', search],
    enabled: search.trim().length >= 2,
    queryFn: async () => {
      const term = escapeFilterTerm(search)
      const { data, error } = await supabase
        .from('customers')
        .select('id, cnpj_cpf, name, city, state')
        .or(`name.ilike.%${term}%,cnpj_cpf.ilike.%${term}%`)
        .order('name', { ascending: true })
        .range(0, 24)

      if (error) throw error
      return (data ?? []) as Pick<Customer, 'id' | 'cnpj_cpf' | 'name' | 'city' | 'state'>[]
    },
  })
}
