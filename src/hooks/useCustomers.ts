import { useQuery } from '@tanstack/react-query'
import { supabase } from '../services/supabase'
import type { Customer, CustomerDetail, CustomerListItem } from '../types/database'

export type CustomerFilters = {
  search: string
}

export function useCustomers(filters: CustomerFilters) {
  return useQuery({
    queryKey: ['customers', filters],
    queryFn: async () => {
      let query = supabase
        .from('customers')
        .select('*, bls(id)', { count: 'exact' })
        .order('name', { ascending: true })
        .range(0, 499)

      if (filters.search) {
        query = query.or(
          `name.ilike.%${filters.search}%,trade_name.ilike.%${filters.search}%,cnpj_cpf.ilike.%${filters.search}%`,
        )
      }

      const { data, error, count } = await query
      if (error) throw error

      return {
        rows: (data ?? []) as unknown as CustomerListItem[],
        count: count ?? 0,
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
