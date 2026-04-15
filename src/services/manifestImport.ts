import { onlyDigits } from '../lib/utils'
import { findMatchedCustomer, loadCustomerMaps } from './customerReconciliation'
import { calculateBlLocalCharges } from './localCharges'
import { countDistinctManifestContainers, type ParsedManifest } from './manifestParser'
import { supabase } from './supabase'
import { syncManifestPolEtdSchedules } from './voyageRouteSchedules'

export type ImportManifestArgs = {
  filename: string
  voyageId: number
  manifest: ParsedManifest
  uploadedBy: string
  /** F-02: hash opcional do arquivo original; habilita dedupe por (voyage, cargo_mode, hash). */
  fileHash?: string | null
}

/**
 * Importa um manifesto CNTR de forma transacional.
 *
 * A operação inteira (criação do batch, upsert dos BLs, troca dos containers,
 * registro de erros e atualização de status) é delegada à função PL/pgSQL
 * `import_manifest_transactional`. Isso garante atomicidade: se qualquer etapa
 * falhar, nada fica persistido — impedindo o cenário de BLs com zero
 * containers por delete+insert parcial (F-01).
 *
 * Dedup: se `fileHash` for informado, a unique index parcial
 * `uq_import_batches_voyage_hash` rejeita imports duplicados do mesmo
 * arquivo na mesma viagem/cargo_mode (F-02).
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

    if (!customerId && (document || bl.consignee)) {
      reviewReasons.add('Cliente nao vinculado automaticamente')
    }

    if (document && customerMatch?.matchType === 'name') {
      reviewReasons.add('Cliente vinculado por nome; validar CNPJ')
    }

    return {
      id: bl.id,
      shipper: bl.shipper,
      consignee: matchedCustomer?.name ?? bl.consignee,
      cargo_description: bl.cargo_description,
      customer_id: customerId,
      pol: bl.pol,
      pod: bl.pod,
      total_weight_kg: bl.total_weight_kg,
      total_cbm: bl.total_cbm,
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

  // Dispara cálculo de taxas locais em background para todos os BLs importados.
  // Não bloqueia o retorno do import — falhas de cálculo não invalidam o import.
  const importedBlIds = manifest.bls.map((bl) => bl.id)
  void triggerLocalChargesForBls(importedBlIds, uploadedBy)

  return batchId as number
}

/**
 * Calcula taxas locais em lotes pequenos (fire-and-forget).
 * Erros por BL individual são silenciados para não afetar o fluxo de importação;
 * o operador pode recalcular manualmente em Taxas Locais se necessário.
 */
async function triggerLocalChargesForBls(blIds: string[], actorId: string) {
  const batchSize = 5
  for (let i = 0; i < blIds.length; i += batchSize) {
    const batch = blIds.slice(i, i + batchSize)
    await Promise.allSettled(
      batch.map((blId) => calculateBlLocalCharges(blId, { actorId, recalculate: false })),
    )
  }
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
