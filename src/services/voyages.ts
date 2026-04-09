import { supabase } from './supabase'
import type { VoyageFormValues } from './voyageForm'

export async function createVoyage(form: VoyageFormValues) {
  const carrierId = await getOrCreateCarrier(form.carrierName, form.carrierScac)
  const vesselId = await getOrCreateVessel(form.vesselName, form.vesselImo, carrierId)

  const { data: created, error: createError } = await supabase
    .from('voyages')
    .insert({
      vessel_id: vesselId,
      voyage_number: form.voyageNumber.trim(),
      pol_id: null,
      pod_id: null,
      status: form.status,
    })
    .select('id')
    .single()

  if (createError || !created) throw createError

  return created
}

export async function updateVoyage(voyageId: number, form: VoyageFormValues) {
  const carrierId = await getOrCreateCarrier(form.carrierName, form.carrierScac)
  const vesselId = await getOrCreateVessel(form.vesselName, form.vesselImo, carrierId)

  const { data: updated, error: updateError } = await supabase
    .from('voyages')
    .update({
      vessel_id: vesselId,
      voyage_number: form.voyageNumber.trim(),
      status: form.status,
    })
    .eq('id', voyageId)
    .select('id')
    .single()

  if (updateError || !updated) throw updateError

  return updated
}

export async function deleteVoyage(voyageId: number) {
  const [bls, batches] = await Promise.all([
    supabase.from('bls').select('id', { count: 'exact', head: true }).eq('voyage_id', voyageId).range(0, 0),
    supabase.from('import_batches').select('id', { count: 'exact', head: true }).eq('voyage_id', voyageId).range(0, 0),
  ])

  const firstError = [bls, batches].find((result) => result.error)?.error
  if (firstError) throw firstError

  const blCount = bls.count ?? 0
  const batchCount = batches.count ?? 0

  if (blCount > 0 || batchCount > 0) {
    throw new Error(
      `Nao e possivel excluir esta viagem porque ela possui ${blCount} B/L(s) e ${batchCount} importacao(oes) vinculada(s). Limpe o operacional dessa viagem antes.`,
    )
  }

  const { error } = await supabase.from('voyages').delete().eq('id', voyageId)
  if (error) throw error
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
