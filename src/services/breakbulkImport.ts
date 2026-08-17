import { chunkArray } from '../lib/utils'
import { findMatchedCustomer, loadCustomerMaps, resolveCustomerLink } from './customerReconciliation'
import { calculateBlLocalCharges } from './charges/chargeOperationsService'
import { supabase } from './supabase'
import type { Json } from '../types/database'
import {
  buildBreakbulkSummaryDescription,
  parseBreakbulkManifestBuffer,
  parseBreakbulkManifestFile,
  type ParsedBreakbulkManifest,
} from './breakbulkManifestParser'

export {
  parseBreakbulkManifestBuffer,
  parseBreakbulkManifestFile,
  type ParsedBreakbulkManifest,
}

export async function importBreakbulkManifest({
  filename,
  voyageId,
  manifest,
  uploadedBy,
}: {
  filename: string
  voyageId: number
  manifest: ParsedBreakbulkManifest
  uploadedBy: string
}) {
  const { error: voyageError } = await supabase.from('voyages').select('id').eq('id', voyageId).single()
  if (voyageError) throw voyageError

  const customerMaps = await loadCustomerMaps()

  const existingModeByBl = new Map<string, 'container' | 'carga_solta' | null>()
  const existingCeByBl = new Map<string, string | null>()
  const blIds = manifest.bls.map((bl) => bl.bl_id)
  for (const chunk of chunkArray(blIds, 400)) {
    const { data, error } = await supabase.from('bls').select('id, cargo_mode, ce_mercante').in('id', chunk)
    if (error) throw error
    for (const row of data ?? []) {
      existingModeByBl.set(String(row.id), (row.cargo_mode as 'container' | 'carga_solta' | null) ?? null)
      existingCeByBl.set(String(row.id), row.ce_mercante ?? null)
    }
  }

  const invalidBls = new Set<string>()
  const importErrors = [...manifest.rowErrors]

  const blRows = manifest.bls.flatMap((bl) => {
    const existingMode = existingModeByBl.get(bl.bl_id)
    if (existingMode === 'container') {
      importErrors.push({
        row: bl.rowNumber,
        message: `BL ${bl.bl_id} ja existe como container e nao pode ser sobrescrito como BB.`,
        raw: { bl_id: bl.bl_id },
      })
      invalidBls.add(bl.bl_id)
      return []
    }

    const customerMatch = findMatchedCustomer(
      {
        cnpjCpf: bl.cnpj_cpf,
        consignee: bl.consignee,
      },
      customerMaps,
    )
    const link = resolveCustomerLink(customerMatch)
    const reviewReasons = new Set<string>()

    if (!link.customerId) {
      reviewReasons.add('Cliente nao vinculado automaticamente')
    }

    return [
      {
        id: bl.bl_id,
        voyage_id: voyageId,
        cargo_mode: 'carga_solta' as const,
        // A autoridade sobre o CE Mercante é a importação de CE Mercante, não o
        // manifesto: dos layouts aceitos só o resumo tem coluna CE, e o legado,
        // o de armador e o B/L avulso chegam sempre sem ela. Como a RPC grava o
        // que receber, mandar nulo apagaria em silêncio um CE já emitido.
        ce_mercante: bl.ce_mercante ?? existingCeByBl.get(bl.bl_id) ?? null,
        bb_machine_qty: bl.bb_machine_qty,
        bb_packages_qty: bl.bb_packages_qty,
        bb_packages_total: bl.bb_packages_total,
        bb_weight_ton: bl.bb_weight_ton,
        shipper: bl.shipper,
        consignee: customerMatch?.matchType === 'document' ? customerMatch.customer.name : bl.consignee,
        notify_party: bl.notify_party,
        customer_id: link.customerId,
        suggested_customer_id: link.suggestedCustomerId,
        manifest_customer_cnpj_cpf: bl.cnpj_cpf,
        manifest_customer_name: bl.consignee,
        manifest_customer_email: null,
        customer_reconciliation_status: link.status,
        customer_reconciliation_notes: link.notes,
        billing_hold_reason:
          link.status === 'matched_document' ? null : 'Aguardando reconciliacao de cliente antes do faturamento.',
        pol: bl.pol,
        pod: bl.pod,
        cargo_description:
          manifest.layout === 'summary'
            ? buildBreakbulkSummaryDescription(bl)
            : bl.items.map((item) => item.item_description).filter(Boolean).slice(0, 3).join(' | ') || null,
        total_weight_kg: bl.total_weight_kg,
        total_cbm: bl.total_cbm,
        review_status: reviewReasons.size > 0 ? ('pending_review' as const) : ('ok' as const),
        financial_status: 'pending' as const,
        notes: reviewReasons.size > 0 ? `Pendencias de importacao: ${Array.from(reviewReasons).join(', ')}` : null,
      },
    ]
  })

  const itemRows = manifest.bls
    .filter((bl) => !invalidBls.has(bl.bl_id))
    .flatMap((bl) =>
      bl.items.map((item) => ({
        bl_id: bl.bl_id,
        item_description: item.item_description,
        package_qty: item.package_qty,
        package_unit: item.package_unit,
        gross_weight_kg: item.gross_weight_kg,
        cbm: item.cbm,
        marks: item.marks,
      })),
    )

  const errorRows = importErrors.map((rowError) => ({
    row_number: rowError.row > 0 ? rowError.row : null,
    error_type: 'parser',
    error_message: rowError.message,
    raw_data: rowError.raw as Json,
  }))

  const { data, error } = await supabase.rpc('import_breakbulk_manifest_transactional', {
    p_filename: filename,
    p_voyage_id: voyageId,
    p_uploaded_by: uploadedBy,
    p_total_bls: manifest.bls.length,
    p_bls: blRows,
    p_items: itemRows,
    p_errors: errorRows,
  })
  if (error) throw error
  const batchId = Number((data as { batch_id?: number } | null)?.batch_id)
  if (!Number.isFinite(batchId) || batchId <= 0) {
    throw new Error('A importacao BB nao retornou um lote valido.')
  }

  // Dispara cálculo de taxas locais em background para os BLs importados com sucesso.
  const validBlIds = blRows.map((row) => row.id)
  if (validBlIds.length) {
    void triggerLocalChargesForBls(validBlIds, uploadedBy)
  }

  return batchId
}

async function triggerLocalChargesForBls(blIds: string[], actorId: string) {
  const batchSize = 5
  for (let i = 0; i < blIds.length; i += batchSize) {
    const batch = blIds.slice(i, i + batchSize)
    await Promise.allSettled(
      batch.map((blId) => calculateBlLocalCharges(blId, { actorId, recalculate: false })),
    )
  }
}
