import { onlyDigits } from '../lib/utils'
import { supabase } from './supabase'
import { buildDependencyReport, tallyReasons, type DeleteDependencyReport } from './deleteDependencies'
import { logDeletions } from './deleteAudit'
import type { Customer, CustomerContact } from '../types/database'

type CustomerEditableFields = Pick<
  Customer,
  'name' | 'trade_name' | 'address' | 'city' | 'state' | 'zip' | 'notes' |
  'payment_terms_days' | 'discount_pct' | 'commercial_notes'
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
  const { data, error } = await supabase
    .from('customers')
    .insert({
      cnpj_cpf: onlyDigits(input.cnpjCpf),
      name: input.name.trim(),
      trade_name: normalizeText(input.tradeName),
      address: normalizeText(input.address),
      city: normalizeText(input.city),
      state: normalizeState(input.state),
      zip: normalizeZip(input.zip),
      notes: normalizeText(input.notes),
    })
    .select('*')
    .single()

  if (error || !data) throw error

  const contacts = (input.contacts ?? []).filter(
    (contact) => contact.name.trim() || (contact.email ?? '').trim() || (contact.phone ?? '').trim(),
  )

  if (contacts.length) {
    const contactPayload = contacts.map((contact) => ({
      customer_id: data.id,
      name: contact.name.trim() || 'Contato sem nome',
      email: normalizeText(contact.email),
      phone: normalizeText(contact.phone),
      purpose: contact.purpose ?? 'geral',
      is_primary: contact.is_primary ?? false,
    }))

    const { error: contactError } = await supabase.from('customer_contacts').insert(contactPayload)

    if (contactError) {
      await supabase.from('customers').delete().eq('id', data.id)
      throw contactError
    }
  }

  return data as Customer
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
  const { error: updateError } = await supabase.from('customers').update(payload).eq('id', customerId)
  if (updateError) throw updateError

  const { error: auditError } = await supabase.from('audit_logs').insert(
    changedEntries.map(([field, value]) => ({
      entity_type: 'customer',
      entity_id: String(customerId),
      field_name: field,
      old_value: stringifyValue(original[field]),
      new_value: stringifyValue(value),
      changed_by: changedBy,
      justification,
    })),
  )

  if (auditError) throw auditError
  return true
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

export async function deleteCustomerContact(contactId: number) {
  const { error } = await supabase.from('customer_contacts').delete().eq('id', contactId)
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

type CustomerPortalAccount = {
  id: number
  customer_id: number
  contact_email: string | null
  active: boolean
  created_by: string | null
  last_login_at: string | null
  created_at: string | null
  updated_at: string | null
}

type PortalRpcAction = 'read' | 'upsert' | 'toggle'

type SupabaseRpcError = {
  code?: string | null
  message?: string | null
  details?: string | null
  hint?: string | null
}

export function normalizeCustomerPortalRpcError(error: unknown, action: PortalRpcAction): string {
  const fallback =
    action === 'read'
      ? 'Falha ao consultar o provisionamento do portal do cliente.'
      : action === 'toggle'
        ? 'Falha ao atualizar o status do acesso do portal.'
        : 'Falha ao provisionar o acesso do portal.'

  if (!error || typeof error !== 'object') {
    return fallback
  }

  const rpcError = error as SupabaseRpcError
  const code = rpcError.code ?? ''
  const message = rpcError.message?.trim() ?? ''
  const details = rpcError.details?.trim() ?? ''
  const compositeMessage = `${message} ${details}`.trim().toLowerCase()

  if (
    code === 'PGRST202' ||
    code === '42883' ||
    compositeMessage.includes('schema cache') ||
    compositeMessage.includes('could not find the function public.get_customer_portal_account') ||
    compositeMessage.includes('could not find the function public.upsert_customer_portal_account') ||
    compositeMessage.includes('could not find the function public.set_customer_portal_account_active')
  ) {
    return 'As RPCs do portal nao estao disponiveis no banco. Aplique a migration 025_billing_orchestration_portal.sql no projeto Supabase e recarregue a tela.'
  }

  if (code === '42501' || compositeMessage.includes('permissao administrativa')) {
    return "Usuario autenticado sem permissao administrativa no Supabase. Verifique public.user_profiles.role = 'admin' e active = true."
  }

  if (message) {
    return message
  }

  return fallback
}

export async function getCustomerPortalAccount(customerId: number) {
  const { data, error } = await supabase.rpc('get_customer_portal_account', {
    p_customer_id: customerId,
  })

  if (error) throw new Error(normalizeCustomerPortalRpcError(error, 'read'))
  const payload = (data ?? {}) as CustomerPortalAccount
  return payload.id ? payload : null
}

export async function upsertCustomerPortalAccount(input: {
  customerId: number
  password: string
  contactEmail?: string | null
  active?: boolean
  actorId?: string | null
}) {
  const { data, error } = await supabase.rpc('upsert_customer_portal_account', {
    p_customer_id: input.customerId,
    p_password: input.password,
    p_contact_email: input.contactEmail ?? null,
    p_active: input.active ?? true,
    p_actor: input.actorId ?? null,
  })

  if (error) throw new Error(normalizeCustomerPortalRpcError(error, 'upsert'))
  return (data ?? {}) as CustomerPortalAccount
}

// Cria/atualiza o usuário Supabase Auth (email + senha) vinculado à conta de
// portal. Login canônico do portal — ver docs/adr/0001. Invoca a Edge Function
// provision-portal-user (service role) após a conta existir.
export async function provisionPortalAuthUser(input: {
  accountId: number
  portalEmail: string
  password: string
}) {
  const { data, error } = await supabase.functions.invoke('provision-portal-user', {
    body: {
      customer_portal_account_id: input.accountId,
      portal_email: input.portalEmail,
      password: input.password,
    },
  })

  if (error) {
    // Em falhas não-2xx o supabase-js retorna FunctionsHttpError com o corpo em
    // error.context (um Response). Extrai a mensagem real para exibir ao usuário.
    let message = ''
    const context = (error as { context?: Response }).context
    if (context && typeof context.json === 'function') {
      try {
        const body = await context.json()
        message = (body as { error?: string })?.error ?? ''
      } catch {
        // corpo não-JSON; ignora e usa o fallback
      }
    }
    throw new Error(message || error.message || 'Falha ao provisionar login do portal.')
  }
  return (data ?? {}) as { success?: boolean; auth_user_id?: string }
}

export async function setCustomerPortalAccountActive(input: {
  customerId: number
  active: boolean
  actorId?: string | null
}) {
  const { data, error } = await supabase.rpc('set_customer_portal_account_active', {
    p_customer_id: input.customerId,
    p_active: input.active,
    p_actor: input.actorId ?? null,
  })

  if (error) throw new Error(normalizeCustomerPortalRpcError(error, 'toggle'))
  return (data ?? {}) as CustomerPortalAccount
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
