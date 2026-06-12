import { onlyDigits } from '../lib/utils'
import { findMatchedCustomer, loadCustomerMaps } from './customerReconciliation'
import { countDistinctManifestContainers, type ParsedManifest } from './manifestParser'
import { supabase } from './supabase'
import { buildVoyagePodEntityId, buildVoyagePolEntityId } from './voyageRouteSchedules'

export type ImportManifestArgs = {
  filename: string
  voyageId: number
  manifest: ParsedManifest
  uploadedBy: string
  /** Hash opcional do arquivo original; habilita dedupe por (voyage, cargo_mode, hash). */
  fileHash?: string | null
}

/**
 * Importa um manifesto CNTR de forma transacional, incluindo schedules,
 * billing inicial, flags de limbo e contatos financeiros vindos do manifesto.
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

  const polEtdPayload = manifest.manifest_etd
    ? Array.from(new Set(manifest.bls.map((bl) => buildVoyagePolEntityId(voyageId, bl.pol)))).map((entityId) => ({
        entity_id: entityId,
        etd: manifest.manifest_etd,
      }))
    : []

  const podLinkedPayload = Array.from(new Set(manifest.bls.map((bl) => bl.pod).filter(Boolean))).map((pod) => ({
    entity_id: buildVoyagePodEntityId(voyageId, pod),
  }))

  const contactPayload = blPayload
    .filter((bl) => bl.customer_id && bl.manifest_customer_email?.trim())
    .map((bl) => ({
      customer_id: bl.customer_id,
      email: bl.manifest_customer_email?.trim().toLowerCase(),
    }))

  const { data: batchId, error: rpcError } = await supabase.rpc('import_manifest_with_postprocess_transactional' as never, {
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
    p_pol_etd: polEtdPayload,
    p_pod_linked: podLinkedPayload,
    p_contact_emails: contactPayload,
  } as never)

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

  return batchId as number
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
