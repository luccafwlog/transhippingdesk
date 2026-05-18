import { onlyDigits } from '../lib/utils'
import { supabase } from './supabase'
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

export type CustomerPortalAccount = {
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
