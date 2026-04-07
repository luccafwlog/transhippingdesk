import { supabase } from './supabase'
import type { ParsedManifest } from './manifestParser'
import { onlyDigits } from '../lib/utils'

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
  const { data: batch, error: batchError } = await supabase
    .from('import_batches')
    .insert({
      filename,
      voyage_id: voyageId,
      uploaded_by: uploadedBy,
      status: 'processing',
      total_bls: manifest.bls.length,
      total_containers: manifest.bls.reduce((sum, bl) => sum + bl.containers.length, 0),
      error_count: manifest.rowErrors.length,
    })
    .select()
    .single()

  if (batchError) throw batchError

  const customerIdsByDocument = new Map<string, number>()
  const customersToUpsert = manifest.bls
    .filter((bl) => bl.cnpj_cpf)
    .map((bl) => ({
      cnpj_cpf: onlyDigits(bl.cnpj_cpf),
      name: bl.consignee || bl.cnpj_cpf || 'Cliente sem nome',
    }))

  if (customersToUpsert.length) {
    const uniqueCustomers = Array.from(new Map(customersToUpsert.map((customer) => [customer.cnpj_cpf, customer])).values())
    const { data: customers, error } = await supabase
      .from('customers')
      .upsert(uniqueCustomers, { onConflict: 'cnpj_cpf' })
      .select('id, cnpj_cpf')

    if (error) throw error
    customers?.forEach((customer) => customerIdsByDocument.set(customer.cnpj_cpf, customer.id))
  }

  const blRows = manifest.bls.map((bl) => ({
    id: bl.id,
    voyage_id: voyageId,
    batch_id: batch.id,
    shipper: bl.shipper,
    consignee: bl.consignee,
    customer_id: bl.cnpj_cpf ? customerIdsByDocument.get(onlyDigits(bl.cnpj_cpf)) ?? null : null,
    pol: bl.pol,
    pod: bl.pod,
    total_weight_kg: bl.total_weight_kg,
    total_cbm: bl.total_cbm,
    review_status: bl.review_status,
    financial_status: 'pending' as const,
    notes: bl.review_reasons.length ? `Pendências de importação: ${bl.review_reasons.join(', ')}` : null,
  }))

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
