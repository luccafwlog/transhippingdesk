import { supabase } from './supabase'
import type { VoyageFormValues } from './voyageForm'
import {
  buildVoyagePodEntityId,
  saveVoyagePolSchedule,
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

  await insertVoyageAuditRows([
    makeVoyageAuditRow(created.id, 'created', null, form.voyageNumber.trim(), changedBy),
  ])
  await syncLoadPortEtds(created.id, form, changedBy)
  await syncDischargePortEtas(created.id, form, changedBy)

  return created
}

export async function updateVoyage(voyageId: number, form: VoyageFormValues, changedBy: string | null) {
  const carrierId = await getOrCreateCarrier(form.carrierName, form.carrierScac)
  const vesselId = await getOrCreateVessel(form.vesselName, form.vesselImo, carrierId)
  const { data: current, error: currentError } = await supabase
    .from('voyages')
    .select('vessel_id, voyage_number, status')
    .eq('id', voyageId)
    .single()
  if (currentError) throw currentError

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

  await insertVoyageAuditRows([
    makeVoyageAuditRow(voyageId, 'vessel_id', current?.vessel_id == null ? null : String(current.vessel_id), String(vesselId), changedBy),
    makeVoyageAuditRow(voyageId, 'voyage_number', current?.voyage_number ?? null, form.voyageNumber.trim(), changedBy),
    makeVoyageAuditRow(voyageId, 'status', current?.status ?? null, form.status, changedBy),
  ])
  await syncLoadPortEtds(voyageId, form, changedBy)
  await syncDischargePortEtas(voyageId, form, changedBy)

  return updated
}

export async function cancelVoyage({
  voyageId,
  reason,
  changedBy,
}: {
  voyageId: number
  reason: string
  changedBy: string
}) {
  const normalizedReason = reason.trim()
  if (!normalizedReason) throw new Error('Informe o motivo do cancelamento.')

  const { data: current, error: currentError } = await supabase
    .from('voyages')
    .select('status')
    .eq('id', voyageId)
    .single()
  if (currentError || !current) throw currentError
  if (current.status === 'cancelled') return

  const { error: updateError } = await supabase
    .from('voyages')
    .update({ status: 'cancelled' })
    .eq('id', voyageId)
  if (updateError) throw updateError

  const { error: auditError } = await supabase.from('audit_logs').insert([{
    entity_type: 'voyages',
    entity_id: String(voyageId),
    field_name: 'status',
    old_value: current.status ?? null,
    new_value: 'cancelled',
    changed_by: changedBy,
    justification: `Cancelamento de viagem: ${normalizedReason}`,
  }])
  if (auditError) throw auditError
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
        linked: currentSchedule?.linked ?? false,
        changedBy,
      })
    }),
  )
}

async function syncLoadPortEtds(voyageId: number, form: VoyageFormValues, changedBy: string | null) {
  if (!form.loadPortEtds.length) return

  await Promise.all(
    form.loadPortEtds.map((row) => saveVoyagePolSchedule({
      voyageId,
      pol: row.pol,
      etd: row.etd,
      changedBy,
    })),
  )
}

async function getOrCreateVessel(name: string, imo: string, carrierId: number) {
  const normalizedImo = imo.trim() || null
  const { data: existing, error: existingError } = await supabase
    .from('vessels')
    .select('id, imo, carrier_id')
    .eq('name', name.trim())
    .limit(1)

  if (existingError) throw existingError
  if (existing?.[0]) {
    const vessel = existing[0]
    const updates: { imo?: string; carrier_id?: number } = {}
    if (normalizedImo && vessel.imo !== normalizedImo) updates.imo = normalizedImo
    if (vessel.carrier_id !== carrierId) updates.carrier_id = carrierId

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase.from('vessels').update(updates).eq('id', vessel.id)
      if (updateError) throw updateError
    }

    return vessel.id
  }

  const { data: created, error: createError } = await supabase
    .from('vessels')
    .insert({ name: name.trim(), imo: normalizedImo, carrier_id: carrierId })
    .select('id')
    .single()

  if (createError || !created) throw createError
  return created.id
}

function makeVoyageAuditRow(
  voyageId: number,
  fieldName: 'created' | 'vessel_id' | 'voyage_number' | 'status',
  oldValue: string | null,
  newValue: string | null,
  changedBy: string | null,
) {
  if (!changedBy) return null
  if ((oldValue ?? '') === (newValue ?? '')) return null
  return {
    entity_type: 'voyages',
    entity_id: String(voyageId),
    field_name: fieldName,
    old_value: oldValue,
    new_value: newValue,
    changed_by: changedBy,
    justification: 'Atualizacao de dados da viagem',
  }
}

async function insertVoyageAuditRows(rows: Array<ReturnType<typeof makeVoyageAuditRow>>) {
  const payload = rows.filter(Boolean)
  if (!payload.length) return

  const { error } = await supabase.from('audit_logs').insert(payload)
  if (error) throw error
}

export async function fetchVoyagesWithUnpaidBls(voyageIds: number[]): Promise<Set<number>> {
  if (!voyageIds.length) return new Set<number>()

  const { data, error } = await supabase
    .from('bls')
    .select('voyage_id')
    .in('voyage_id', voyageIds)
    .neq('charge_status', 'exempt')
    .limit(5000)

  if (error) throw error
  return new Set((data ?? []).map((row) => Number((row as { voyage_id: number }).voyage_id)).filter(Boolean))
}

export async function setVoyageShowOnPortal(voyageId: number, show: boolean) {
  const { error } = await supabase
    .from('voyages')
    .update({ show_on_portal: show })
    .eq('id', voyageId)
  if (error) throw error
}

/** Busca viagem por VOY + navio (IMO; fallback nome). null se nao existir. */
export async function findVoyageByNumberAndVessel(
  voyageNumber: string,
  vesselImo: string,
  vesselName: string,
): Promise<number | null> {
  const number = voyageNumber.trim().toUpperCase()
  const imo = vesselImo.trim()
  const name = vesselName.trim().toUpperCase()
  const numberPattern = number.replace(/[\\%_]/g, (char) => `\\${char}`)

  const { data, error } = await supabase
    .from('voyages')
    .select('id, voyage_number, vessel:vessels(name, imo)')
    .ilike('voyage_number', numberPattern)
    .overrideTypes<Array<{ id: number; voyage_number: string; vessel: { name: string | null; imo: string | null } | null }>, { merge: false }>()
  if (error) throw error

  const match = (data ?? []).find((row) => {
    if (row.voyage_number.trim().toUpperCase() !== number) return false
    if (imo && row.vessel?.imo) return row.vessel.imo.trim() === imo
    return (row.vessel?.name ?? '').trim().toUpperCase() === name
  })
  return match?.id ?? null
}
