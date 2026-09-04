import { canonicalizeDocument, canonicalizeValidCnpj } from '../lib/cnpj'
import { onlyDigits } from '../lib/utils'
import { supabase } from './supabase'
import { buildDependencyReport, tallyReasons, type DeleteDependencyReport } from './deleteDependencies'
import { logDeletions } from './deleteAudit'
import type { Customer, CustomerContact } from '../types/database'

type CustomerEditableFields = Pick<
  Customer,
  'name' | 'trade_name' | 'address' | 'city' | 'state' | 'zip' | 'notes'
>

type CreateCustomerContactInput = {
  name: string
  email?: string | null
  phone?: string | null
  purpose?: NonNullable<CustomerContact['purpose']>
  is_primary?: boolean
}

type CreateCustomerInput = {
  cnpjCpf: string
  name: string
  tradeName?: string
  address?: string
  city?: string
  state?: string
  zip?: string
  notes?: string
  contacts?: CreateCustomerContactInput[]
}

export async function createCustomer(input: CreateCustomerInput) {
  const cnpj = canonicalizeValidCnpj(input.cnpjCpf)
  if (!cnpj) throw new Error('CNPJ inválido.')
  const contacts = (input.contacts ?? []).filter(
    (contact) => contact.name.trim() || (contact.email ?? '').trim() || (contact.phone ?? '').trim(),
  )
  const { data, error } = await supabase.rpc('create_customer_with_contacts', {
    p_customer: {
      cnpj_cpf: cnpj,
      name: input.name.trim(),
      trade_name: normalizeText(input.tradeName),
      address: normalizeText(input.address),
      city: normalizeText(input.city),
      state: normalizeState(input.state),
      zip: normalizeZip(input.zip),
      notes: normalizeText(input.notes),
    },
    p_contacts: contacts.map((contact) => ({
      name: contact.name.trim(),
      email: normalizeText(contact.email),
      phone: normalizeText(contact.phone),
      purpose: contact.purpose ?? 'geral',
      is_primary: contact.is_primary ?? false,
    })),
  })

  if (error || !data) throw error
  return data as unknown as Customer
}

export async function updateCustomerWithAudit({
  customerId,
  original,
  values,
  changedBy,
  justification,
}: {
  customerId: number
  original: CustomerEditableFields
  values: CustomerEditableFields
  changedBy: string
  justification: string
}) {
  const changedEntries = Object.entries(values).filter(
    ([field, value]) => stringifyValue(original[field as keyof CustomerEditableFields]) !== stringifyValue(value),
  ) as Array<[keyof CustomerEditableFields, CustomerEditableFields[keyof CustomerEditableFields]]>

  if (!changedEntries.length) return false

  const payload = Object.fromEntries(changedEntries) as Partial<CustomerEditableFields>
  const { data, error } = await supabase.rpc('update_customer_with_audit', {
    p_customer_id: customerId,
    p_updates: payload,
    p_changed_by: changedBy,
    p_justification: justification,
  })

  if (error) throw error
  return data === true
}

export async function upsertCustomerContact(customerId: number, contact: Omit<CustomerContact, 'customer_id' | 'created_at'>) {
  const payload = {
    customer_id: customerId,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    purpose: contact.purpose,
    is_primary: contact.is_primary ?? false,
  }

  const query = contact.id
    ? supabase.from('customer_contacts').update(payload).eq('id', contact.id).select('*').single()
    : supabase.from('customer_contacts').insert(payload).select('*').single()

  const { data, error } = await query
  if (error || !data) throw error
  return data as CustomerContact
}

// Adiciona um e-mail de contato a um cliente existente direto da fila de
// revisao. Qualquer e-mail satisfaz a trava do gate; a classificacao
// 'faturamento' aqui e so o default administrativo.
export async function addCustomerEmail(customerId: number, email: string) {
  const { error } = await supabase.from('customer_contacts').insert({
    customer_id: customerId,
    name: 'Contato faturamento',
    email: email.trim(),
    purpose: 'faturamento',
    is_primary: false,
  })
  if (error) throw error
}

export async function deleteCustomerContact(contactId: number) {
  const { error } = await supabase
    .from('customer_contacts')
    .update({ deactivated_at: new Date().toISOString(), is_primary: false } as never)
    .eq('id', contactId)
  if (error) throw error
}

/**
 * Verifica bloqueadores de exclusao de clientes. Um cliente com B/L, fatura
 * (local ou demurrage), recebivel ou lote de faturamento vinculado nao pode ser
 * excluido — destruiria historico operacional/fiscal. Contatos e overrides de
 * tarifa NAO bloqueiam: sao apagados em cascata controlada por `deleteCustomers`.
 */
export async function checkCustomerDependencies(ids: number[]): Promise<DeleteDependencyReport<number>> {
  if (ids.length === 0) return { deletableIds: [], blockedIds: [] }

  const [bls, invoices, demurrageInvoices, receivables, billingBatches] = await Promise.all([
    supabase.from('bls').select('customer_id').in('customer_id', ids),
    supabase.from('invoices').select('customer_id').in('customer_id', ids),
    supabase.from('demurrage_invoices').select('customer_id').in('customer_id', ids),
    supabase.from('bl_receivables').select('customer_id').in('customer_id', ids),
    supabase.from('billing_batches').select('customer_id').in('customer_id', ids),
  ])
  for (const result of [bls, invoices, demurrageInvoices, receivables, billingBatches]) {
    if (result.error) throw result.error
  }

  const reasons = new Map<number, string[]>()
  tallyReasons(reasons, bls.data ?? [], 'customer_id', (count) => `${count} B/L(s) vinculado(s)`)
  tallyReasons(reasons, invoices.data ?? [], 'customer_id', (count) => `${count} fatura(s) emitida(s)`)
  tallyReasons(reasons, demurrageInvoices.data ?? [], 'customer_id', (count) => `${count} fatura(s) de demurrage`)
  tallyReasons(reasons, receivables.data ?? [], 'customer_id', (count) => `${count} recebivel(is)`)
  tallyReasons(reasons, billingBatches.data ?? [], 'customer_id', (count) => `${count} lote(s) de faturamento`)

  return buildDependencyReport(ids, reasons)
}

/**
 * Exclui clientes e seus dados cadastrais (contatos e overrides de tarifa). O
 * banco auto-resolve `customer_portal_accounts`/`customer_portal_sessions`
 * (CASCADE) e zera referencias em `granite_bls`, `customer_reconciliation_queue`
 * e `pricing_rule_versions` (SET NULL). Pressupoe que os ids ja passaram por
 * `checkCustomerDependencies`.
 */
export async function deleteCustomers(ids: number[], changedBy?: string | null) {
  if (ids.length === 0) return

  const contacts = await supabase.from('customer_contacts').delete().in('customer_id', ids)
  if (contacts.error) throw contacts.error

  const overrides = await supabase.from('customer_rate_overrides').delete().in('customer_id', ids)
  if (overrides.error) throw overrides.error

  const customers = await supabase.from('customers').delete().in('id', ids)
  if (customers.error) throw customers.error

  await logDeletions('customer', ids, changedBy)
}

type CustomerInvoiceBalanceRow = {
  customer_id: number | null
  status: string | null
  balance_brl: number | string | null
}

export function sumIssuedInvoiceBalancesByCustomer(rows: CustomerInvoiceBalanceRow[]) {
  const balances = new Map<number, number>()

  for (const row of rows) {
    if (row.status !== 'issued' || row.customer_id == null) continue
    balances.set(row.customer_id, (balances.get(row.customer_id) ?? 0) + Number(row.balance_brl ?? 0))
  }

  return balances
}

export async function fetchIssuedInvoiceBalanceByCustomer(customerIds?: number[]) {
  if (customerIds && customerIds.length === 0) return new Map<number, number>()

  const pageSize = 1000
  const rows: CustomerInvoiceBalanceRow[] = []
  let from = 0

  while (true) {
    let query = supabase
      .from('invoices')
      .select('customer_id, status, balance_brl')
      .eq('status', 'issued')
      .range(from, from + pageSize - 1)

    if (customerIds) {
      query = query.in('customer_id', Array.from(new Set(customerIds)))
    }

    const { data, error } = await query
    if (error) throw error

    rows.push(...((data ?? []) as CustomerInvoiceBalanceRow[]))
    if ((data ?? []).length < pageSize) break
    from += pageSize
  }

  return sumIssuedInvoiceBalancesByCustomer(rows)
}

function stringifyValue(value: unknown) {
  return value === null || value === undefined ? '' : String(value)
}

function normalizeText(value?: string | null) {
  const text = (value ?? '').trim()
  return text || null
}

function normalizeState(value?: string | null) {
  const text = normalizeText(value)
  return text ? text.toUpperCase().slice(0, 2) : null
}

function normalizeZip(value?: string | null) {
  const digits = onlyDigits(value)
  return digits || null
}

/** Busca cliente existente por CNPJ (fallback de cadastro duplicado). */
export async function findCustomerIdByDocument(cnpjCpf: string): Promise<number | null> {
  const { data } = await supabase
    .from('customers')
    .select('id')
    .eq('cnpj_cpf', canonicalizeDocument(cnpjCpf))
    .maybeSingle()
  return data?.id ?? null
}
