import { onlyDigits } from '../lib/utils'
import { supabase } from './supabase'
import type { Customer, CustomerContact } from '../types/database'

type CustomerEditableFields = Pick<Customer, 'name' | 'trade_name' | 'address' | 'city' | 'state' | 'zip' | 'notes'>

export async function createCustomer(input: { cnpjCpf: string; name: string }) {
  const { data, error } = await supabase
    .from('customers')
    .insert({
      cnpj_cpf: onlyDigits(input.cnpjCpf),
      name: input.name.trim(),
    })
    .select('*')
    .single()

  if (error || !data) throw error
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

export async function linkBlToCustomer({
  blId,
  customerId,
  previousCustomerId,
  changedBy,
  justification,
}: {
  blId: string
  customerId: number | null
  previousCustomerId: number | null
  changedBy: string
  justification: string
}) {
  const { error: updateError } = await supabase.from('bls').update({ customer_id: customerId }).eq('id', blId)
  if (updateError) throw updateError

  const { error: auditError } = await supabase.from('audit_logs').insert({
    entity_type: 'bl',
    entity_id: blId,
    field_name: 'customer_id',
    old_value: stringifyValue(previousCustomerId),
    new_value: stringifyValue(customerId),
    changed_by: changedBy,
    justification,
  })

  if (auditError) throw auditError
}

function stringifyValue(value: unknown) {
  return value === null || value === undefined ? '' : String(value)
}
