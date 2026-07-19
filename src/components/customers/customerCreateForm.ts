import type { CustomerContact } from '../../types/database'

export type CustomerCreateErrors = Partial<{ cnpjCpf: string; name: string }>

export type CustomerContactForm = {
  _id: string
  name: string
  email: string
  phone: string
  purpose: NonNullable<CustomerContact['purpose']>
  is_primary: boolean
}

export type CreateCustomerForm = {
  cnpjCpf: string
  name: string
  tradeName: string
  address: string
  city: string
  state: string
  zip: string
  notes: string
  contacts: CustomerContactForm[]
}

export function newCustomerContact(): CustomerContactForm {
  return { _id: crypto.randomUUID(), name: '', email: '', phone: '', purpose: 'geral', is_primary: false }
}

export const emptyCreateCustomerForm: CreateCustomerForm = {
  cnpjCpf: '',
  name: '',
  tradeName: '',
  address: '',
  city: '',
  state: '',
  zip: '',
  notes: '',
  contacts: [newCustomerContact()],
}
