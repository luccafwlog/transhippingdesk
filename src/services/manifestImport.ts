import { onlyDigits } from '../lib/utils'
import { countDistinctManifestContainers, type ParsedManifest } from './manifestParser'
import { supabase } from './supabase'

export async function importManifest({
  filename,
  voyageId,
  manifest,
  uploadedBy,
}: {
  filename: string
  voyageId: number
  manifest: ParsedManifest
  uploadedBy: string
}) {
  const distinctContainerCount = countDistinctManifestContainers(manifest)
  const { error: voyageError } = await supabase.from('voyages').select('id').eq('id', voyageId).single()

  if (voyageError) throw voyageError

  const { data: batch, error: batchError } = await supabase
    .from('import_batches')
    .insert({
      filename,
      voyage_id: voyageId,
      uploaded_by: uploadedBy,
      status: 'processing',
      total_bls: manifest.bls.length,
      total_containers: distinctContainerCount,
      error_count: manifest.rowErrors.length,
    })
    .select()
    .single()

  if (batchError) throw batchError

  const customersByDocument = new Map<string, { id: number; name: string }>()
  const customerDocuments = Array.from(
    new Set(
      manifest.bls
        .map((bl) => onlyDigits(bl.cnpj_cpf))
        .filter((document): document is string => Boolean(document)),
    ),
  )

  if (customerDocuments.length) {
    const { data: customers, error } = await supabase
      .from('customers')
      .select('id, cnpj_cpf, name')
      .in('cnpj_cpf', customerDocuments)

    if (error) throw error
    customers?.forEach((customer) =>
      customersByDocument.set(customer.cnpj_cpf, {
        id: customer.id,
        name: customer.name,
      }),
    )
  }

  const blRows = manifest.bls.map((bl) => {
    const document = onlyDigits(bl.cnpj_cpf)
    const matchedCustomer = document ? customersByDocument.get(document) ?? null : null
    const customerId = matchedCustomer?.id ?? null
    const reviewReasons = new Set(bl.review_reasons)

    if (document && !customerId) {
      reviewReasons.add('Cliente nao cadastrado na base')
    }

    return {
      id: bl.id,
      voyage_id: voyageId,
      batch_id: batch.id,
      shipper: bl.shipper,
      consignee: matchedCustomer?.name ?? bl.consignee,
      customer_id: customerId,
      pol: bl.pol,
      pod: bl.pod,
      total_weight_kg: bl.total_weight_kg,
      total_cbm: bl.total_cbm,
      review_status: reviewReasons.size > 0 ? ('pending_review' as const) : bl.review_status,
      financial_status: 'pending' as const,
      notes: reviewReasons.size > 0 ? `Pendencias de importacao: ${Array.from(reviewReasons).join(', ')}` : null,
    }
  })

  if (blRows.length) {
    const { error } = await supabase.from('bls').upsert(blRows, { onConflict: 'id' })
    if (error) throw error

    const blIds = blRows.map((bl) => bl.id)
    const { error: deleteError } = await supabase.from('bl_containers').delete().in('bl_id', blIds)
    if (deleteError) throw deleteError
  }

  const containerRows = manifest.bls.flatMap((bl) =>
    bl.containers.map((container) => ({
      bl_id: bl.id,
      container_number: container.container_number,
      seal_number: container.seal_number,
      type: container.type,
      tare_weight_kg: container.tare_weight_kg ?? null,
      gross_weight_kg: container.gross_weight_kg,
      cbm: container.cbm,
      is_oog: container.is_oog,
      is_imo: container.is_imo,
      imo_class: container.imo_class,
      un_number: container.un_number,
    })),
  )

  if (containerRows.length) {
    const { error } = await supabase.from('bl_containers').insert(containerRows)
    if (error) throw error
  }

  if (manifest.rowErrors.length) {
    const { error } = await supabase.from('import_errors').insert(
      manifest.rowErrors.map((rowError) => ({
        batch_id: batch.id,
        row_number: rowError.row,
        error_type: 'parser',
        error_message: rowError.message,
        raw_data: rowError.raw,
      })),
    )

    if (error) throw error
  }

  const { error: updateError } = await supabase
    .from('import_batches')
    .update({ status: manifest.rowErrors.length ? 'partial' : 'completed' })
    .eq('id', batch.id)

  if (updateError) throw updateError

  return batch.id
}
