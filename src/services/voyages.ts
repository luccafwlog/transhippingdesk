import { supabase } from './supabase'

export type VoyageFormValues = {
  carrierName: string
  carrierScac: string
  vesselName: string
  vesselImo: string
  voyageNumber: string
  polName: string
  polLocode: string
  podName: string
  podLocode: string
  etd: string
  eta: string
  status: 'active' | 'completed' | 'cancelled'
}

export const initialVoyageFormValues: VoyageFormValues = {
  carrierName: '',
  carrierScac: '',
  vesselName: '',
  vesselImo: '',
  voyageNumber: '',
  polName: '',
  polLocode: '',
  podName: '',
  podLocode: '',
  etd: '',
  eta: '',
  status: 'active',
}

export async function createVoyage(form: VoyageFormValues) {
  const carrierId = await getOrCreateCarrier(form.carrierName, form.carrierScac)
  const vesselId = await getOrCreateVessel(form.vesselName, form.vesselImo, carrierId)
  const polId = await getOrCreatePort(form.polName, form.polLocode)
  const podId = await getOrCreatePort(form.podName, form.podLocode)

  const { data: created, error: createError } = await supabase
    .from('voyages')
    .insert({
      vessel_id: vesselId,
      voyage_number: form.voyageNumber.trim(),
      pol_id: polId,
      pod_id: podId,
      etd: form.etd || null,
      eta: form.eta || null,
      status: form.status,
    })
    .select('id')
    .single()

  if (createError || !created) throw createError

  return created
}

async function getOrCreateCarrier(name: string, scac: string) {
  let query = supabase.from('carriers').select('id').limit(1)
  if (scac.trim()) {
    query = query.eq('scac', scac.trim())
  } else {
    query = query.eq('name', name.trim())
  }

  const { data: existing, error: existingError } = await query
  if (existingError) throw existingError
  if (existing?.[0]) return existing[0].id

  const { data: created, error: createError } = await supabase
    .from('carriers')
    .insert({ name: name.trim(), scac: scac.trim() || null })
    .select('id')
    .single()

  if (createError || !created) throw createError
  return created.id
}

async function getOrCreateVessel(name: string, imo: string, carrierId: number) {
  const { data: existing, error: existingError } = await supabase
    .from('vessels')
    .select('id')
    .eq('name', name.trim())
    .limit(1)

  if (existingError) throw existingError
  if (existing?.[0]) return existing[0].id

  const { data: created, error: createError } = await supabase
    .from('vessels')
    .insert({ name: name.trim(), imo: imo.trim() || null, carrier_id: carrierId })
    .select('id')
    .single()

  if (createError || !created) throw createError
  return created.id
}

async function getOrCreatePort(name: string, locode: string) {
  let query = supabase.from('ports').select('id').limit(1)
  if (locode.trim()) {
    query = query.eq('locode', locode.trim())
  } else {
    query = query.eq('name', name.trim())
  }

  const { data: existing, error: existingError } = await query
  if (existingError) throw existingError
  if (existing?.[0]) return existing[0].id

  const { data: created, error: createError } = await supabase
    .from('ports')
    .insert({ name: name.trim(), locode: locode.trim() || null })
    .select('id')
    .single()

  if (createError || !created) throw createError
  return created.id
}
