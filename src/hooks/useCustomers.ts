import { useQuery } from '@tanstack/react-query'
import { supabase } from '../services/supabase'
import type { Customer, CustomerDetail, CustomerListItem } from '../types/database'

export type CustomerFilters = {
  search: string
  emailStatus: '' | 'with' | 'without'
  blStatus: '' | 'with' | 'without'
  pendingStatus: '' | 'with' | 'without'
  page: number
  pageSize: number
}

export function useCustomers(filters: CustomerFilters) {
  return useQuery({
    queryKey: ['customers', filters],
    queryFn: async () => {
      const from = filters.page * filters.pageSize
      const to = from + filters.pageSize - 1

      let query = supabase
        .from('customers')
        .select('*, bls(id), customer_contacts(id)', { count: 'exact' })
        .order('name', { ascending: true })
        .range(from, to)

      if (filters.search) {
        query = query.or(
          `name.ilike.%${filters.search}%,trade_name.ilike.%${filters.search}%,cnpj_cpf.ilike.%${filters.search}%`,
        )
      }

      const { data, error, count } = await query
      if (error) throw error

      const rows = ((data ?? []) as unknown as CustomerListItem[]).filter((row) => {
        const hasEmails = (row.customer_contacts?.length ?? 0) > 0
        const hasBls = (row.bls?.length ?? 0) > 0
        const hasPendingBalance = Number(row.pending_balance ?? 0) > 0

        if (filters.emailStatus === 'with' && !hasEmails) return false
        if (filters.emailStatus === 'without' && hasEmails) return false

        if (filters.blStatus === 'with' && !hasBls) return false
        if (filters.blStatus === 'without' && hasBls) return false

        if (filters.pendingStatus === 'with' && !hasPendingBalance) return false
        if (filters.pendingStatus === 'without' && hasPendingBalance) return false

        return true
      })

      return {
        rows,
        count: rows.length,
        totalCount: count ?? 0,
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
          bls(id, consignee, financial_status, review_status, created_at),
          invoices(id, invoice_number, issued_at, due_date, total_brl, status)
        `,
        )
        .eq('cnpj_cpf', cnpj!)
        .single()

      if (error) throw error
      return data as unknown as CustomerDetail
    },
  })
}

export function useCustomerLookup(search: string) {
  return useQuery({
    queryKey: ['customer-lookup', search],
    enabled: search.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, cnpj_cpf, name, city, state')
        .or(`name.ilike.%${search}%,cnpj_cpf.ilike.%${search}%`)
        .order('name', { ascending: true })
        .range(0, 24)

      if (error) throw error
      return (data ?? []) as Pick<Customer, 'id' | 'cnpj_cpf' | 'name' | 'city' | 'state'>[]
    },
  })
}
