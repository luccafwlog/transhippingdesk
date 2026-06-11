import { onlyDigits } from '../lib/utils'
import { findMatchedCustomer, loadCustomerMaps } from './customerReconciliation'
import { countDistinctManifestContainers, type ParsedManifest } from './manifestParser'
import { supabase } from './supabase'
import { syncManifestPolEtdSchedules, syncManifestPodLinked } from './voyageRouteSchedules'

export type ImportManifestArgs = {
  filename: string
  voyageId: number
  manifest: ParsedManifest
  uploadedBy: string
  /** Hash opcional do arquivo original; habilita dedupe por (voyage, cargo_mode, hash). */
  fileHash?: string | null
}

/**
 * Importa um manifesto CNTR de forma transacional.
 *
 * A operacao inteira (criacao do batch, upsert dos BLs, troca dos containers,
 * registro de erros e atualizacao de status) e delegada a funcao PL/pgSQL
 * `import_manifest_transactional`. Isso garante atomicidade: se qualquer etapa
 * falhar, nada fica persistido e evita BLs sem containers por delete+insert
 * parcial.
 *
 * Dedup: se `fileHash` for informado, a unique index parcial
 * `uq_import_batches_voyage_hash` rejeita imports duplicados do mesmo
 * arquivo na mesma viagem/cargo_mode.
 */
export async function importManifest({
  filename,
  voyageId,
  manifest,
  uploadedBy,
  fileHash = null,
}: ImportManifestArgs) {
  const distinctContainerCount = countDistinctManifestContainers(manifest)

  const { error: voyageError } = await supabase.from('voyages').select('id').eq('id', voyageId).single()
  if (voyageError) throw voyageError

  const customerMaps = await loadCustomerMaps()

  const blPayload = manifest.bls.map((bl) => {
    const document = onlyDigits(bl.cnpj_cpf)
    const customerMatch = findMatchedCustomer(
      {
        cnpjCpf: bl.cnpj_cpf,
        consignee: bl.consignee,
      },
      customerMaps,
    )
    const matchedCustomer = customerMatch?.customer ?? null
    const customerId = matchedCustomer?.id ?? null
    const reviewReasons = new Set(bl.review_reasons)
    const reconciliationStatus =
      customerId && customerMatch?.matchType === 'document'
        ? 'matched_document'
        : customerId && customerMatch?.matchType === 'name'
          ? 'matched_name'
          : 'missing_customer'

    if (!customerId && (document || bl.consignee)) {
      reviewReasons.add('Cliente nao vinculado automaticamente')
    }

    if (document && customerMatch?.matchType === 'name') {
      reviewReasons.add('Cliente vinculado por nome; validar CNPJ')
    }

    if (!bl.customer_email) {
      reviewReasons.add('E-mail do cliente ausente no manifesto')
    }

    return {
      id: bl.id,
      shipper: bl.shipper,
      consignee: matchedCustomer?.name ?? bl.consignee,
      manifest_customer_name: bl.consignee,
      manifest_customer_email: bl.customer_email,
      manifest_customer_cnpj_cpf: bl.cnpj_cpf,
      cargo_description: bl.cargo_description,
      customer_id: customerId,
      pol: bl.pol,
      pod: bl.pod,
      total_weight_kg: bl.total_weight_kg,
      total_cbm: bl.total_cbm,
      customer_reconciliation_status: reconciliationStatus,
      customer_reconciliation_notes:
        reconciliationStatus === 'matched_document'
          ? 'Cliente reconciliado automaticamente por CNPJ/CPF.'
          : reconciliationStatus === 'matched_name'
            ? 'Cliente sugerido por nome; validar documento.'
            : 'Cliente nao encontrado na base cadastral.',
      billing_hold_reason:
        reconciliationStatus === 'matched_document' ? null : 'Aguardando reconciliacao de cliente antes do faturamento.',
      review_status: reviewReasons.size > 0 ? 'pending_review' : bl.review_status,
      financial_status: 'pending',
      notes: reviewReasons.size > 0 ? `Pendencias de importacao: ${Array.from(reviewReasons).join(', ')}` : null,
    }
  })

  const containerPayload = manifest.bls.flatMap((bl) =>
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

  const errorPayload = manifest.rowErrors.map((rowError) => ({
    row_number: rowError.row,
    error_type: 'parser',
    error_message: rowError.message,
    raw_data: rowError.raw ?? null,
  }))

  const { data: batchId, error: rpcError } = await supabase.rpc('import_manifest_transactional', {
    p_filename: filename,
    p_voyage_id: voyageId,
    p_uploaded_by: uploadedBy,
    p_cargo_mode: 'container',
    p_file_hash: fileHash,
    p_total_bls: manifest.bls.length,
    p_total_containers: distinctContainerCount,
    p_bls: blPayload,
    p_containers: containerPayload,
    p_errors: errorPayload,
  })

  if (rpcError) {
    if (rpcError.code === '23505' && rpcError.message?.includes('uq_import_batches_voyage_hash')) {
      throw new DuplicateManifestImportError(
        'Este arquivo ja foi importado nesta viagem. Se isso foi intencional, altere o arquivo antes de reenviar.',
      )
    }
    if (rpcError.code === 'P0429') {
      throw new RateLimitImportError(
        rpcError.message ?? 'Limite de importacoes atingido. Aguarde antes de importar novamente.',
      )
    }
    throw rpcError
  }

  await syncManifestPolEtdSchedules({
    voyageId,
    manifest,
    changedBy: uploadedBy,
  })

  await syncManifestPodLinked({
    voyageId,
    manifest,
    changedBy: uploadedBy,
  })

  const { error: billingError } = await supabase.rpc('run_billing_for_import_batch', {
    p_batch_id: batchId,
    p_actor: uploadedBy,
    p_recalculate: true,
  })

  if (billingError) {
    throw billingError
  }

  // --- NEW LOGIC: Identify BLs that failed billing (no charges calculated and not exempt) ---
  const importedBlIds = blPayload.map((bl) => bl.id)
  
  const { data: chargeData } = await supabase
    .from('charge_calculations')
    .select('bl_id')
    .in('bl_id', importedBlIds)
    
  const blsWithCharges = new Set((chargeData || []).map(c => String(c.bl_id)))
  const limboBlIds = importedBlIds.filter(id => !blsWithCharges.has(id))

  if (limboBlIds.length > 0) {
    const { data: blsToUpdate } = await supabase
      .from('bls')
      .select('id, notes, charge_status')
      .in('id', limboBlIds)
      .neq('charge_status', 'exempt') // Do not flag exempt BLs

    if (blsToUpdate && blsToUpdate.length > 0) {
      const updates = blsToUpdate.map(bl => {
        let newNotes = bl.notes || ''
        const errorMsg = 'Falha crítica: Nenhuma tabela de preco ou tarifa encontrada.'
        if (!newNotes) {
          newNotes = `Pendencias de importacao: ${errorMsg}`
        } else if (!newNotes.includes(errorMsg)) {
          newNotes += `, ${errorMsg}`
        }
        
        return {
          id: bl.id,
          review_status: 'pending_review' as const,
          charge_status: 'review_required' as const,
          billing_hold_reason: 'Falha crítica: Nenhuma tabela de preco ou tarifa encontrada. Adicione os precos e recalcule.',
          notes: newNotes
        }
      })
      
      // Update one by one or upsert. Since it's a few, we can do promises.
      await Promise.all(updates.map(updateData => 
        supabase.from('bls').update({
          review_status: updateData.review_status,
          charge_status: updateData.charge_status,
          billing_hold_reason: updateData.billing_hold_reason,
          notes: updateData.notes
        }).eq('id', updateData.id)
      ))
    }
  }
  // --- END NEW LOGIC ---

  await syncManifestContactEmails(blPayload)

  return batchId as number
}

/**
 * Para cada BL com cliente matched e e-mail no manifesto, cria o contato no
 * cadastro do cliente caso aquele e-mail ainda nao esteja registrado.
 * Erros sao silenciados para nao bloquear o retorno da importacao.
 */
async function syncManifestContactEmails(
  blPayload: Array<{ customer_id: number | null; manifest_customer_email?: string | null }>,
) {
  const toSync = new Map<number, Set<string>>()
  for (const bl of blPayload) {
    const email = bl.manifest_customer_email?.trim().toLowerCase()
    if (bl.customer_id && email) {
      const existing = toSync.get(bl.customer_id) ?? new Set<string>()
      existing.add(email)
      toSync.set(bl.customer_id, existing)
    }
  }

  if (!toSync.size) return

  const customerIds = Array.from(toSync.keys())

  const { data: existing } = await supabase
    .from('customer_contacts')
    .select('customer_id, email')
    .in('customer_id', customerIds)

  const existingSet = new Set(
    (existing ?? [])
      .filter((c) => c.email)
      .map((c) => `${c.customer_id}:${c.email!.trim().toLowerCase()}`),
  )

  const toInsert = Array.from(toSync.entries()).flatMap(([customerId, emails]) =>
    Array.from(emails)
      .filter((email) => !existingSet.has(`${customerId}:${email}`))
      .map((email) => ({
        customer_id: customerId,
        name: 'Contato manifesto',
        email,
        purpose: 'financeiro' as const,
        is_primary: false,
      })),
  )

  if (!toInsert.length) return

  await supabase.from('customer_contacts').insert(toInsert)
}


export class DuplicateManifestImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DuplicateManifestImportError'
  }
}

export class RateLimitImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RateLimitImportError'
  }
}

/** Calcula SHA-256 de um ArrayBuffer e retorna em hex (para uso com fileHash). */
export async function computeFileHash(buffer: ArrayBuffer): Promise<string> {
  const subtle = (globalThis.crypto ?? (globalThis as unknown as { crypto?: Crypto }).crypto)?.subtle
  if (!subtle) return ''
  const digest = await subtle.digest('SHA-256', buffer)
  const bytes = new Uint8Array(digest)
  let hex = ''
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return hex
}

