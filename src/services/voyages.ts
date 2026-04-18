import { supabase } from './supabase'
import type { VoyageFormValues } from './voyageForm'
import {
  buildVoyagePodEntityId,
  listVoyagePodSchedules,
  saveVoyagePodSchedule,
} from './voyageRouteSchedules'

export async function createVoyage(form: VoyageFormValues, changedBy: string | null) {
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

  await syncDischargePortEtas(created.id, form, changedBy)

  return created
}

export async function updateVoyage(voyageId: number, form: VoyageFormValues, changedBy: string | null) {
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

  await syncDischargePortEtas(voyageId, form, changedBy)

  return updated
}

export async function deleteVoyage(voyageId: number) {
  const [bls, batches, graniteManifests, vaziosManifests] = await Promise.all([
    supabase.from('bls').select('id', { count: 'exact', head: true }).eq('voyage_id', voyageId).range(0, 0),
    supabase.from('import_batches').select('id', { count: 'exact', head: true }).eq('voyage_id', voyageId).range(0, 0),
    supabase.from('granite_manifests').select('id', { count: 'exact', head: true }).eq('voyage_id', voyageId).range(0, 0),
    supabase.from('vazios_manifests').select('id', { count: 'exact', head: true }).eq('voyage_id', voyageId).range(0, 0),
  ])

  const firstError = [bls, batches, graniteManifests, vaziosManifests].find((result) => result.error)?.error
  if (firstError) throw firstError

  const blCount = bls.count ?? 0
  const batchCount = batches.count ?? 0
  const graniteManifestCount = graniteManifests.count ?? 0
  const vaziosManifestCount = vaziosManifests.count ?? 0

  if (blCount > 0 || batchCount > 0 || graniteManifestCount > 0 || vaziosManifestCount > 0) {
    throw new Error(
      `Nao e possivel excluir esta viagem porque ela possui ${blCount} B/L(s), ${batchCount} importacao(oes) CNTR/BB, ${graniteManifestCount} manifesto(s) de granito e ${vaziosManifestCount} manifesto(s) de vazios vinculados. Limpe o operacional dessa viagem antes.`,
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

async function syncDischargePortEtas(voyageId: number, form: VoyageFormValues, changedBy: string | null) {
  if (!form.dischargePortEtas.length) return

  const entityIds = form.dischargePortEtas.map((row) => buildVoyagePodEntityId(voyageId, row.pod))
  const currentSchedules = await listVoyagePodSchedules(entityIds)

  await Promise.all(
    form.dischargePortEtas.map(async (row) => {
      const entityId = buildVoyagePodEntityId(voyageId, row.pod)
      const currentSchedule = currentSchedules.get(entityId)

      await saveVoyagePodSchedule({
        voyageId,
        pod: row.pod,
        eta: row.eta,
        etb: currentSchedule?.etb ?? null,
        ata: currentSchedule?.ata ?? null,
        atd: currentSchedule?.atd ?? null,
        rtw: currentSchedule?.rtw ?? null,
        ceStatus: currentSchedule?.ceStatus ?? null,
        linked: currentSchedule?.linked ?? null,
        changedBy,
      })
    }),
  )
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
