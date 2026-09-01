import { supabase } from './supabase'
import type { CustomerCommunicationNature, CustomerContactPreference } from '../types/database'

export async function updateCustomerContactPreference(input: {
  contactId: number
  nature: CustomerCommunicationNature
  enabled: boolean
}): Promise<CustomerContactPreference> {
  const { data, error } = await supabase
    .from('customer_contact_preferences')
    .update({ enabled: input.enabled, source: 'interno' })
    .eq('contact_id', input.contactId)
    .eq('nature', input.nature)
    .select('*')
    .single()

  if (error) throw error
  return data
}
