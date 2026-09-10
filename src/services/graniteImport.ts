import { assertUploadFile } from '../lib/fileGuard'
import { canonicalizeDocument } from '../lib/cnpj'
import { parseImportNumber } from '../lib/importNumber'
import { findMatchedCustomer, loadCustomerMaps, resolveCustomerLink } from './customerReconciliation'
import { createHeaderMapper, createRowErrorCollector, readFirstSheetRows, type RowError } from './importCore'
import { IsoDateSchema, LocodeSchema } from './importValidation'
import { resolvePortCode } from './portCode'
import { supabase } from './supabase'

// Mapeamento de cabeçalhos da planilha COSCO "Relatório de Cargas/Booking"
const HEADER_MAP: Record<string, string> = {
  '#': 'sequence',
  'booking': 'booking_number',
  'bl': 'bl_number',
  'shipper ref.': 'shipper_ref',
  'navio/viagem': 'vessel_voyage',
  'l/port': 'loading_port',
  'd/port': 'discharge_port',
  'shipper': 'shipper_name',
  'cnpj': 'shipper_cnpj',
  'consignee': 'consignee_name',
  'charter': 'charter',
  "shipper's m3": 'shipper_m3',
  "shipper's weight": 'shipper_weight_kg',
  'blocks qtty': 'blocks_qty',
  'received blocks qtty': 'received_blocks_qty',
  'balance': 'blocks_balance_raw',
  "shipper's final m3": 'final_m3',
  'real weight': 'real_weight_kg',
  'stockyard': 'stockyard',
  'remarks': 'remarks',
  'restricao parcial': 'partial_restriction',
  'coscos transportation': 'cosco_transport',
  'fragile blocks': 'fragile_blocks',
  'cssc selection': 'cssc_selection',
  'prontidao de carga': 'cargo_readiness_date',
  'fase': 'phase',
}

export type ReconciliationStatus = 'matched' | 'suggested_name' | 'missing_cnpj' | 'not_found'

export type ParsedGraniteBl = {
  rowNumber: number
  sequence: number | null
  booking_number: string | null
  bl_number: string
  shipper_ref: string | null
  vessel_voyage: string | null
  loading_port: string | null
  discharge_port: string | null
  shipper_name: string | null
  shipper_cnpj: string | null
  consignee_name: string | null
  charter: string | null
  shipper_m3: number | null
  shipper_weight_kg: number | null
  blocks_qty: number | null
  received_blocks_qty: number | null
  final_m3: number | null
  real_weight_kg: number
  stockyard: string | null
  remarks: string | null
  partial_restriction: boolean
  cosco_transport: string | null
  fragile_blocks: number | null
  cssc_selection: string | null
  cargo_readiness_date: string | null
  phase: string | null
  clientId: number | null
  suggestedClientId: number | null
  reconciliationStatus: ReconciliationStatus
}

export type ParsedGraniteManifest = {
  vesselVoyage: string
  bls: ParsedGraniteBl[]
  rowErrors: RowError[]
}

export async function parseGraniteManifestFile(file: File): Promise<ParsedGraniteManifest> {
  assertUploadFile(file, ['xlsx', 'xls'])
  const buffer = await file.arrayBuffer()
  return parseGraniteManifestBuffer(buffer)
}

async function parseGraniteManifestBuffer(buffer: ArrayBuffer): Promise<ParsedGraniteManifest> {
  const rows = await readFirstSheetRows(buffer)
  const mapRow = createHeaderMapper(rows[0], HEADER_MAP)

  const customerMaps = await loadCustomerMaps()
  const bls: ParsedGraniteBl[] = []
  const rowErrors = createRowErrorCollector()
  const seenBlNumbers = new Set<string>()

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2 // linha 1 = cabeçalho, dados começam na 2

    const mapped = mapRow(row)

    const blNumber = String(mapped['bl_number'] ?? '').trim().toUpperCase()
    if (!blNumber) {
      rowErrors.add(rowNumber, 'BL ausente — linha ignorada.', row)
      return
    }
    if (seenBlNumbers.has(blNumber)) {
      rowErrors.add(rowNumber, `BL ${blNumber} duplicado na planilha.`, row)
      return
    }
    seenBlNumbers.add(blNumber)

    const realWeightRaw = parseGraniteNumber(mapped['real_weight_kg'], 'real_weight_kg', rowNumber, rowErrors)
    if (realWeightRaw === null || realWeightRaw <= 0) {
      rowErrors.add(rowNumber, `BL ${blNumber}: Real Weight ausente ou zero.`, row)
      return
    }

    const cnpjRaw = String(mapped['shipper_cnpj'] ?? '').trim()
    const cnpjCanonical = canonicalizeDocument(cnpjRaw)
    const shipperName = String(mapped['shipper_name'] ?? '').trim() || null

    let clientId: number | null = null
    let suggestedClientId: number | null = null
    let reconciliationStatus: ReconciliationStatus = 'missing_cnpj'

    if (cnpjCanonical || shipperName) {
      const match = findMatchedCustomer({ cnpjCpf: cnpjRaw, consignee: shipperName ?? '' }, customerMaps)
      const link = resolveCustomerLink(match)
      clientId = link.customerId
      suggestedClientId = link.suggestedCustomerId
      reconciliationStatus = link.status === 'matched_document'
        ? 'matched'
        : link.status === 'matched_name'
          ? 'suggested_name'
          : cnpjCanonical ? 'not_found' : 'missing_cnpj'
    }

    const loadingPort = resolveGranitePort(
      String(mapped['loading_port'] ?? '').trim() || null,
      'L/PORT',
      blNumber,
      rowNumber,
      rowErrors,
      row,
    )
    const dischargePort = resolveGranitePort(
      String(mapped['discharge_port'] ?? '').trim() || null,
      'D/PORT',
      blNumber,
      rowNumber,
      rowErrors,
      row,
    )
    const cargoReadinessRaw = String(mapped['cargo_readiness_date'] ?? '').trim()
    const cargoReadinessDate = parseDateBR(cargoReadinessRaw)
    if (cargoReadinessRaw && cargoReadinessDate === null) {
      rowErrors.add(
        rowNumber,
        `BL ${blNumber}: Cargo Readiness Date inválida (${cargoReadinessRaw}). Use DD/MM/AAAA.`,
        row,
      )
    }

    bls.push({
      rowNumber,
      sequence: parseGraniteNumber(mapped['sequence'], 'sequence', rowNumber, rowErrors),
      booking_number: String(mapped['booking_number'] ?? '').trim() || null,
      bl_number: blNumber,
      shipper_ref: String(mapped['shipper_ref'] ?? '').trim() || null,
      vessel_voyage: String(mapped['vessel_voyage'] ?? '').trim() || null,
      // Task 6 (ADR 2026-07-31): normaliza para LOCODE aqui, na entrada, para
      // que o casamento com a escala (agencyDepartureReport.ts) funcione sem
      // depender de correção retroativa dos dados já gravados.
      loading_port: loadingPort,
      discharge_port: dischargePort,
      shipper_name: shipperName,
      shipper_cnpj: cnpjCanonical || cnpjRaw || null,
      consignee_name: String(mapped['consignee_name'] ?? '').trim() || null,
      charter: String(mapped['charter'] ?? '').trim() || null,
      shipper_m3: parseGraniteNumber(mapped['shipper_m3'], 'shipper_m3', rowNumber, rowErrors),
      shipper_weight_kg: parseGraniteNumber(mapped['shipper_weight_kg'], 'shipper_weight_kg', rowNumber, rowErrors),
      blocks_qty: parseGraniteNumber(mapped['blocks_qty'], 'blocks_qty', rowNumber, rowErrors),
      received_blocks_qty: parseGraniteNumber(mapped['received_blocks_qty'], 'received_blocks_qty', rowNumber, rowErrors),
      final_m3: parseGraniteNumber(mapped['final_m3'], 'final_m3', rowNumber, rowErrors),
      real_weight_kg: realWeightRaw,
      stockyard: String(mapped['stockyard'] ?? '').trim() || null,
      remarks: String(mapped['remarks'] ?? '').trim() || null,
      partial_restriction: String(mapped['partial_restriction'] ?? '').trim().toLowerCase() === 'sim',
      cosco_transport: String(mapped['cosco_transport'] ?? '').trim() || null,
      fragile_blocks: parseGraniteNumber(mapped['fragile_blocks'], 'fragile_blocks', rowNumber, rowErrors),
      cssc_selection: String(mapped['cssc_selection'] ?? '').trim() || null,
      cargo_readiness_date: cargoReadinessDate,
      phase: String(mapped['phase'] ?? '').trim() || null,
      clientId,
      suggestedClientId,
      reconciliationStatus,
    })
  })

  const vesselVoyage = bls.find((bl) => bl.vessel_voyage)?.vessel_voyage ?? ''

  return { vesselVoyage, bls, rowErrors: rowErrors.errors }
}

/**
 * O template COSCO é uma planilha operacional brasileira. A convenção é
 * declarada aqui para que `1e3`, `12abc` e separadores ambíguos nunca sejam
 * convertidos silenciosamente em peso/quantidade.
 */
function parseGraniteNumber(
  value: unknown,
  field: string,
  row: number,
  rowErrors: ReturnType<typeof createRowErrorCollector>,
): number | null {
  const parsed = parseImportNumber(value, 'pt-BR')
  if (parsed.kind === 'empty') return null
  if (parsed.kind !== 'value') {
    rowErrors.add(row, `Campo ${field} inválido (${parsed.reason}).`, value)
    return null
  }
  const number = Number(parsed.decimal)
  if (!Number.isFinite(number)) {
    rowErrors.add(row, `Campo ${field} inválido (não finito).`, value)
    return null
  }
  return number
}

function parseDateBR(value: string): string | null {
  if (!value) return null
  // dd/mm/yy or dd/mm/yyyy
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!match) return null
  const [, d, m, y] = match
  const year = y.length === 2 ? `20${y}` : y
  const isoDate = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  if (!IsoDateSchema.safeParse(isoDate).success) return null
  const parsed = new Date(Date.UTC(Number(year), Number(m) - 1, Number(d)))
  if (
    parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() !== Number(m) - 1
    || parsed.getUTCDate() !== Number(d)
  ) return null
  return isoDate
}

function resolveGranitePort(
  value: string | null,
  field: 'L/PORT' | 'D/PORT',
  blNumber: string,
  rowNumber: number,
  rowErrors: ReturnType<typeof createRowErrorCollector>,
  raw: unknown,
): string | null {
  if (!value) return null
  const resolved = resolvePortCode(value)
  if (!resolved.code || !resolved.recognized || !LocodeSchema.safeParse(resolved.code).success) {
    rowErrors.add(
      rowNumber,
      `BL ${blNumber}: ${field} ${resolved.code ?? value} não reconhecido como LOCODE.`,
      raw,
    )
  }
  return resolved.code
}

export type ImportGraniteArgs = {
  filename: string
  voyageId: number
  manifest: ParsedGraniteManifest
  uploadedBy: string
  /** Permite importar BLs sem client_id resolvido; esses ficarão sem faturamento */
  allowPending?: boolean
}

export async function importGraniteManifest({
  filename,
  voyageId,
  manifest,
  uploadedBy,
  allowPending = true,
}: ImportGraniteArgs): Promise<{ manifestId: string; pendingCount: number }> {
  const totalWeightKg = manifest.bls.reduce((sum, bl) => sum + bl.real_weight_kg, 0)
  const vesselVoyage = manifest.vesselVoyage || manifest.bls[0]?.vessel_voyage || filename

  const blRows = manifest.bls
    .filter((bl) => allowPending || bl.clientId !== null || bl.suggestedClientId !== null)
    .map((bl) => ({
      client_id: bl.clientId,
      suggested_client_id: bl.suggestedClientId,
      sequence: bl.sequence,
      booking_number: bl.booking_number,
      bl_number: bl.bl_number,
      shipper_ref: bl.shipper_ref,
      vessel_voyage: bl.vessel_voyage,
      loading_port: bl.loading_port,
      discharge_port: bl.discharge_port,
      shipper_name: bl.shipper_name,
      shipper_cnpj: bl.shipper_cnpj,
      consignee_name: bl.consignee_name,
      charter: bl.charter,
      shipper_m3: bl.shipper_m3,
      shipper_weight_kg: bl.shipper_weight_kg,
      blocks_qty: bl.blocks_qty,
      received_blocks_qty: bl.received_blocks_qty,
      final_m3: bl.final_m3,
      real_weight_kg: bl.real_weight_kg,
      stockyard: bl.stockyard,
      remarks: bl.remarks,
      partial_restriction: bl.partial_restriction,
      cosco_transport: bl.cosco_transport,
      fragile_blocks: bl.fragile_blocks,
      cssc_selection: bl.cssc_selection,
      cargo_readiness_date: bl.cargo_readiness_date,
      phase: bl.phase,
      charge_status: 'not_calculated' as const,
    }))

  const { data, error } = await supabase.rpc('import_granite_manifest_transactional', {
    p_voyage_id: voyageId,
    p_vessel_voyage: vesselVoyage,
    p_loading_port: manifest.bls[0]?.loading_port ?? null,
    p_discharge_port: manifest.bls[0]?.discharge_port ?? null,
    p_total_bls: manifest.bls.length,
    p_total_weight_kg: totalWeightKg,
    p_uploaded_by: uploadedBy,
    p_bls: blRows,
  })
  if (error) throw error
  if (data === null || typeof data !== 'object' || Array.isArray(data) || !('manifest_id' in data) || typeof data.manifest_id !== 'string') {
    throw new Error('Falha ao criar manifesto.')
  }

  const pendingCount = manifest.bls.filter((bl) => bl.reconciliationStatus !== 'matched').length

  return { manifestId: data.manifest_id, pendingCount }
}
