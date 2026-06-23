import { assertUploadSize } from '../lib/fileGuard'
import { asString, chunkArray, onlyDigits } from '../lib/utils'
import { extractNcmCodes } from '../lib/ncm'
import { findMatchedCustomer, loadCustomerMaps } from './customerReconciliation'
import { calculateBlLocalCharges } from './charges/chargeOperationsService'
import { supabase } from './supabase'
import type { Json } from '../types/database'

const headerMap = {
  bl_id: ['bl', 'b/l', 'bill of lading'],
  ce_mercante: ['ce', 'ce mercante', 'ce_mercante'],
  machine_qty: ['maquinas', 'máquinas', 'machines'],
  packages_qty: ['packages'],
  packages_total: ['packages total', 'total packages'],
  gross_weight_ton: ['weight (ton)', 'weight(ton)', 'weight ton', 'weight'],
  cbm: ['cbm (m3)', 'cbm(m3)', 'cbm', 'm3'],
  shipper: ['shipper', 'embarcador'],
  consignee: ['consignee', 'consignatario', 'cnee'],
  notify_party: ['notify', 'notify party'],
  cnpj_cpf: ['cnpj', 'cnpj/cpf', 'cpf', 'documento'],
  pol: ['pol', 'porto origem'],
  pod: ['pod', 'porto destino'],
  item_description: ['descricao', 'descricao da carga', 'mercadoria'],
  package_qty: ['volumes', 'quantidade', 'qty'],
  package_unit: ['unidade', 'unidade volumes'],
  marks: ['marcas', 'marks'],
  gross_weight_kg: ['peso_kg', 'peso', 'peso bruto', 'weight (kg)'],
} as const

const bbRequiredHeaders = ['BL', 'CE', 'MAQUINAS', 'PACKAGES', 'PACKAGES TOTAL', 'WEIGHT (TON)', 'CBM (M3)', 'SHIPPER', 'CONSIGNEE', 'NOTIFY'] as const
const legacyRequiredHeaders = ['BL', 'CONSIGNATARIO', 'CNPJ', 'POL', 'POD', 'DESCRICAO', 'VOLUMES', 'PESO_KG', 'CBM'] as const

type DestinationField = keyof typeof headerMap
type BreakbulkLayout = 'summary' | 'legacy' | 'carrier'

type BreakbulkImportRow = {
  rowNumber: number
  bl_id: string
  ce_mercante: string | null
  shipper: string | null
  consignee: string
  notify_party: string | null
  cnpj_cpf: string | null
  pol: string | null
  pod: string | null
  bb_machine_qty: number | null
  bb_packages_qty: number | null
  bb_packages_total: number | null
  bb_weight_ton: number | null
  total_weight_kg: number
  total_cbm: number
  items: Array<{
    item_description: string
    package_qty: number
    package_unit: string | null
    gross_weight_kg: number
    cbm: number
    marks: string | null
  }>
}

export type ParsedBreakbulkManifest = {
  layout: BreakbulkLayout
  bls: BreakbulkImportRow[]
  rowErrors: { row: number; message: string; raw: unknown }[]
}

export async function parseBreakbulkManifestFile(file: File): Promise<ParsedBreakbulkManifest> {
  assertUploadSize(file)
  const buffer = await file.arrayBuffer()
  return parseBreakbulkManifestBuffer(buffer)
}

export async function parseBreakbulkManifestBuffer(buffer: ArrayBuffer): Promise<ParsedBreakbulkManifest> {
  const XLSX = await import('@e965/xlsx')
  const workbook = XLSX.read(buffer, { type: 'array', cellText: true })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]

  if (!firstSheet) {
    throw new Error('Arquivo sem abas validas.')
  }

  const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(firstSheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  })

  if (looksLikeCarrierBreakbulk(matrix)) {
    return parseCarrierBreakbulkRows(matrix)
  }

  const rawHeaders = (matrix[0] ?? []).map((cell) => String(cell ?? '').trim())
  const layout = detectLayout(rawHeaders)
  validateRequiredHeaders(rawHeaders, layout)

  const objectRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '', raw: false })
  return parseBreakbulkRows(objectRows, layout)
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
  const blIds = manifest.bls.map((bl) => bl.bl_id)
  for (const chunk of chunkArray(blIds, 400)) {
    const { data, error } = await supabase.from('bls').select('id, cargo_mode').in('id', chunk)
    if (error) throw error
    for (const row of data ?? []) {
      existingModeByBl.set(String(row.id), (row.cargo_mode as 'container' | 'carga_solta' | null) ?? null)
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
    const matchedCustomer = customerMatch?.customer ?? null
    const customerId = matchedCustomer?.id ?? null
    const reconciliationStatus =
      customerId && customerMatch?.matchType === 'document'
        ? 'matched_document'
        : customerId && customerMatch?.matchType === 'name'
          ? 'matched_name'
          : 'missing_customer'
    const reviewReasons = new Set<string>()

    if (!customerId) {
      reviewReasons.add('Cliente nao vinculado automaticamente')
    }

    if (onlyDigits(bl.cnpj_cpf) && customerMatch?.matchType === 'name') {
      reviewReasons.add('Cliente vinculado por nome; validar CNPJ')
    }

    return [
      {
        id: bl.bl_id,
        voyage_id: voyageId,
        cargo_mode: 'carga_solta' as const,
        ce_mercante: bl.ce_mercante,
        bb_machine_qty: bl.bb_machine_qty,
        bb_packages_qty: bl.bb_packages_qty,
        bb_packages_total: bl.bb_packages_total,
        bb_weight_ton: bl.bb_weight_ton,
        shipper: bl.shipper,
        consignee: matchedCustomer?.name ?? bl.consignee,
        notify_party: bl.notify_party,
        customer_id: customerId,
        manifest_customer_cnpj_cpf: bl.cnpj_cpf,
        manifest_customer_name: bl.consignee,
        manifest_customer_email: null,
        customer_reconciliation_status: reconciliationStatus,
        customer_reconciliation_notes:
          reconciliationStatus === 'matched_document'
            ? 'Cliente reconciliado automaticamente por CNPJ/CPF.'
            : reconciliationStatus === 'matched_name'
              ? 'Cliente sugerido por nome; validar documento.'
              : 'Cliente nao encontrado na base cadastral.',
        billing_hold_reason:
          reconciliationStatus === 'matched_document' ? null : 'Aguardando reconciliacao de cliente antes do faturamento.',
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

function parseBreakbulkRows(rows: Record<string, unknown>[], layout: BreakbulkLayout): ParsedBreakbulkManifest {
  return layout === 'summary' ? parseSummaryRows(rows) : parseLegacyRows(rows)
}

function parseCarrierBreakbulkRows(rawRows: (string | number | null)[][]): ParsedBreakbulkManifest {
  const rowErrors: ParsedBreakbulkManifest['rowErrors'] = []
  const bls: BreakbulkImportRow[] = []

  const headerRowIndex = rawRows.findIndex((row) => isCarrierHeaderRow(row))
  const headerRow = headerRowIndex >= 0 ? rawRows[headerRowIndex] : []
  const colBl = findCarrierColumnIndex(headerRow, ['bl no.', 'b/l no.', 'b/l nr.', 'b/l nr'])
  const colPod = findCarrierColumnIndex(headerRow, ['pod', 'port of discharge', 'disch port'])
  const colDescription = findCarrierColumnIndex(headerRow, ['description of goods', 'description', 'decription'])
  const colQty = findCarrierColumnIndex(headerRow, ['number of pieces', 'quantity', 'pkg', 'packages'])
  const colWeight = findCarrierColumnIndex(headerRow, ['gross weight', 'g.w(kgs)', 'gross weight(kgs)', 'weight (kgs)'])
  const colCbm = findCarrierColumnIndex(headerRow, ['measurement', 'cbm', 'cube (cbm)'])
  const colMarks = findCarrierColumnIndex(headerRow, ['marks', 'marks and numbers'])
  const colShipper = findCarrierColumnIndex(headerRow, ['shipper'])
  const colConsignee = findCarrierColumnIndex(headerRow, ['consignee'])
  const colNotify = findCarrierColumnIndex(headerRow, ['notify', 'notify party'])

  const previewText = rawRows.slice(0, 20).map((row) => row.map((cell) => asString(cell)).join(' ')).join(' ')
  let currentPol = inferPortFromText(previewText, 'pol') ?? ''
  let currentPod = inferPortFromText(previewText, 'pod') ?? ''

  for (let index = 0; index < rawRows.length; index += 1) {
    const row = rawRows[index] ?? []
    const col0 = asString(row[0])
    const col2 = asString(row[2])
    const col4 = asString(row[4])
    const candidateBl = asString(colBl >= 0 ? row[colBl] : row[0])

    if (/^POL\b/i.test(col2)) currentPol = normalizePortCode(col2.replace(/^POL\s+/i, '').trim()) || currentPol
    if (/^POD\b/i.test(col4)) currentPod = normalizePortCode(col4.replace(/^POD\s+/i, '').trim()) || currentPod
    if (/^LOADING PORT[:\s]/i.test(col0)) currentPol = normalizePortCode(col0.split(':').slice(1).join(':').trim()) || currentPol
    if (/^PORT OF LOADING[:\s]/i.test(col0)) currentPol = normalizePortCode(col0.split(':').slice(1).join(':').trim()) || currentPol
    if (/^DISCH PORT[:\s]/i.test(col0)) currentPod = normalizePortCode(col0.split(':').slice(1).join(':').trim()) || currentPod
    if (/^PORT OF DISCHARGE[:\s]/i.test(col0)) currentPod = normalizePortCode(col0.split(':').slice(1).join(':').trim()) || currentPod
    const joinedRow = row.map((cell) => asString(cell)).join(' ')
    if (/LOADG\/DISCHARG PORT/i.test(joinedRow)) {
      const normalized = normalizeHeader(joinedRow)
      if (normalized.includes('taicang')) currentPol = 'CNTAC'
      if (normalized.includes('zhangjiagang')) currentPol = 'CNZJG'
      if (normalized.includes('vitoria')) currentPod = 'BRVIX'
      if (normalized.includes('salvador')) currentPod = 'BRSSA'
    }
    if (index <= headerRowIndex) continue

    if (!looksLikeCarrierBreakbulkBl(candidateBl)) continue

    const groupRows = collectCarrierBlRows(rawRows, index, colBl)
    index += groupRows.length - 1

    const descriptionBlock = joinedStringsFromColumn(groupRows, colDescription >= 0 ? colDescription : 3)
    const grossWeightKg =
      firstNumberFromColumn(groupRows, colWeight) ?? findNumberBeforeUnit(groupRows, /^KGS?$/i) ?? 0
    const cbm = firstNumberFromColumn(groupRows, colCbm) ?? findNumberBeforeUnit(groupRows, /^CBMS?$/i) ?? 0
    const packageInfo = parseCarrierPackageInfo(descriptionBlock, firstValueFromColumn(groupRows, colQty))
    const itemDescription = normalizeCarrierBreakbulkDescription(descriptionBlock)
    const splitParties = parseCarrierSplitPartyRows(groupRows)
    const combinedParties = parseCarrierCombinedParties(asString(row[0]))
    const partiesFromBlock = parseCarrierBreakbulkParties([asString(row[0]), asString(row[6])].join('\n'))
    const shipper =
      asString(colShipper >= 0 ? row[colShipper] : '') ||
      splitParties.shipper ||
      combinedParties.shipper ||
      partiesFromBlock.shipper
    const consignee =
      asString(colConsignee >= 0 ? row[colConsignee] : '') ||
      splitParties.consignee ||
      combinedParties.consignee ||
      partiesFromBlock.consignee
    const notifyParty =
      asString(colNotify >= 0 ? row[colNotify] : '') ||
      splitParties.notifyParty ||
      combinedParties.notifyParty ||
      partiesFromBlock.notifyParty
    const cnpj = extractTaxId(consignee) || splitParties.cnpj || combinedParties.cnpj || partiesFromBlock.cnpj

    if (!consignee) {
      rowErrors.push({
        row: index + 1,
        message: `Consignatario nao identificado para o BL ${candidateBl}.`,
        raw: row,
      })
    }

    bls.push({
      rowNumber: index + 1,
      bl_id: candidateBl,
      ce_mercante: null,
      shipper: shipper || null,
      consignee: consignee || 'CONSIGNATARIO NAO IDENTIFICADO',
      notify_party: notifyParty || null,
      cnpj_cpf: cnpj || null,
      pol: currentPol || null,
      pod: normalizePortCode(asString(colPod >= 0 ? row[colPod] : '')) || currentPod || null,
      bb_machine_qty: extractCarrierMachineQty(descriptionBlock),
      bb_packages_qty: packageInfo.quantity,
      bb_packages_total: packageInfo.quantity,
      bb_weight_ton: grossWeightKg > 0 ? grossWeightKg / 1000 : null,
      total_weight_kg: grossWeightKg,
      total_cbm: cbm,
      items: [
        {
          item_description: itemDescription,
          package_qty: packageInfo.quantity ?? 0,
          package_unit: packageInfo.unit,
          gross_weight_kg: grossWeightKg,
          cbm,
          marks: asNullableString(colMarks >= 0 ? row[colMarks] : row[1]),
        },
      ],
    })
  }

  return {
    layout: 'carrier',
    bls,
    rowErrors,
  }
}

function parseSummaryRows(rows: Record<string, unknown>[]): ParsedBreakbulkManifest {
  const rowErrors: ParsedBreakbulkManifest['rowErrors'] = []
  const parsedRows: BreakbulkImportRow[] = []

  rows.forEach((row, index) => {
    const mapped = mapRow(row)
    const rowNumber = index + 2

    const bl_id = normalizeKey(mapped.bl_id)
    const ce_mercante = asNullableDigits(mapped.ce_mercante)
    const machineQty = parseNumber(mapped.machine_qty)
    const packagesQty = parseNumber(mapped.packages_qty)
    const packagesTotal = parseNumber(mapped.packages_total)
    const weightTon = parseNumber(mapped.gross_weight_ton)
    const cbm = parseNumber(mapped.cbm)
    const shipper = asNullableString(mapped.shipper)
    const consignee = asString(mapped.consignee)
    const notifyParty = asNullableString(mapped.notify_party)
    const cnpjCpf = asNullableDigits(mapped.cnpj_cpf)
    const pol = nullableKey(mapped.pol)
    const pod = nullableKey(mapped.pod)

    if (!bl_id || machineQty === null || packagesQty === null || packagesTotal === null || weightTon === null || cbm === null || !shipper || !consignee || !notifyParty) {
      rowErrors.push({ row: rowNumber, message: 'Colunas obrigatorias ausentes ou invalidas para o layout BB.', raw: row })
      return
    }

    if (machineQty < 0 || packagesQty < 0 || packagesTotal < 0 || weightTon <= 0 || cbm < 0) {
      rowErrors.push({ row: rowNumber, message: 'Maquinas, packages, peso e CBM devem ser numericos validos.', raw: row })
      return
    }

    parsedRows.push({
      rowNumber,
      bl_id,
      ce_mercante,
      shipper,
      consignee,
      notify_party: notifyParty,
      cnpj_cpf: cnpjCpf,
      pol,
      pod,
      bb_machine_qty: machineQty,
      bb_packages_qty: packagesQty,
      bb_packages_total: packagesTotal,
      bb_weight_ton: weightTon,
      total_weight_kg: weightTon * 1000,
      total_cbm: cbm,
      items: [],
    })
  })

  return {
    layout: 'summary',
    bls: parsedRows,
    rowErrors,
  }
}

function parseLegacyRows(rows: Record<string, unknown>[]): ParsedBreakbulkManifest {
  const rowErrors: ParsedBreakbulkManifest['rowErrors'] = []
  const mappedRows: Array<{
    rowNumber: number
    bl_id: string
    consignee: string
    cnpj_cpf: string
    pol: string
    pod: string
    item_description: string
    package_qty: number
    gross_weight_kg: number
    cbm: number
    package_unit: string | null
    marks: string | null
    shipper: string | null
  }> = []

  rows.forEach((row, index) => {
    const mapped = mapRow(row)
    const rowNumber = index + 2

    const bl_id = normalizeKey(mapped.bl_id)
    const consignee = asString(mapped.consignee)
    const cnpj_cpf = onlyDigits(asString(mapped.cnpj_cpf))
    const pol = normalizeKey(mapped.pol)
    const pod = normalizeKey(mapped.pod)
    const item_description = asString(mapped.item_description)
    const package_qty = parseNumber(mapped.package_qty)
    const gross_weight_kg = parseNumber(mapped.gross_weight_kg)
    const cbm = parseNumber(mapped.cbm)
    const package_unit = asNullableString(mapped.package_unit)
    const marks = asNullableString(mapped.marks)
    const shipper = asNullableString(mapped.shipper)

    if (!bl_id || !consignee || !cnpj_cpf || !pol || !pod || !item_description || package_qty === null || gross_weight_kg === null || cbm === null) {
      rowErrors.push({ row: rowNumber, message: 'Colunas obrigatorias ausentes ou invalidas.', raw: row })
      return
    }

    if (package_qty <= 0 || gross_weight_kg <= 0 || cbm < 0) {
      rowErrors.push({ row: rowNumber, message: 'Volumes, peso e CBM devem ser numericos validos.', raw: row })
      return
    }

    mappedRows.push({
      rowNumber,
      bl_id,
      consignee,
      cnpj_cpf,
      pol,
      pod,
      item_description,
      package_qty,
      gross_weight_kg,
      cbm,
      package_unit,
      marks,
      shipper,
    })
  })

  const byBl = new Map<string, BreakbulkImportRow>()

  for (const row of mappedRows) {
    const current = byBl.get(row.bl_id)
    if (!current) {
      byBl.set(row.bl_id, {
        rowNumber: row.rowNumber,
        bl_id: row.bl_id,
        ce_mercante: null,
        shipper: row.shipper,
        consignee: row.consignee,
        notify_party: null,
        cnpj_cpf: row.cnpj_cpf,
        pol: row.pol,
        pod: row.pod,
        bb_machine_qty: null,
        bb_packages_qty: row.package_qty,
        bb_packages_total: row.package_qty,
        bb_weight_ton: row.gross_weight_kg / 1000,
        total_weight_kg: row.gross_weight_kg,
        total_cbm: row.cbm,
        items: [
          {
            item_description: row.item_description,
            package_qty: row.package_qty,
            package_unit: row.package_unit,
            gross_weight_kg: row.gross_weight_kg,
            cbm: row.cbm,
            marks: row.marks,
          },
        ],
      })
      continue
    }

    if (
      current.consignee !== row.consignee ||
      current.cnpj_cpf !== row.cnpj_cpf ||
      current.pol !== row.pol ||
      current.pod !== row.pod
    ) {
      rowErrors.push({
        row: row.rowNumber,
        message: `BL ${row.bl_id} possui cabecalho inconsistente entre linhas.`,
        raw: row,
      })
      continue
    }

    current.total_weight_kg += row.gross_weight_kg
    current.total_cbm += row.cbm
    current.bb_packages_total = Number(current.bb_packages_total ?? 0) + row.package_qty
    current.bb_packages_qty = Number(current.bb_packages_qty ?? 0) + row.package_qty
    current.bb_weight_ton = current.total_weight_kg / 1000
    current.items.push({
      item_description: row.item_description,
      package_qty: row.package_qty,
      package_unit: row.package_unit,
      gross_weight_kg: row.gross_weight_kg,
      cbm: row.cbm,
      marks: row.marks,
    })
  }

  return {
    layout: 'legacy',
    bls: Array.from(byBl.values()),
    rowErrors,
  }
}

function detectLayout(rawHeaders: string[]): BreakbulkLayout {
  const normalizedHeaders = rawHeaders.map((header) => normalizeHeader(header))
  const hasSummarySignals =
    normalizedHeaders.includes(normalizeHeader('maquinas')) ||
    normalizedHeaders.includes(normalizeHeader('packages total')) ||
    normalizedHeaders.includes(normalizeHeader('weight (ton)'))

  return hasSummarySignals ? 'summary' : 'legacy'
}

function looksLikeCarrierBreakbulk(rows: (string | number | null)[][]) {
  const joined = rows.slice(0, 40).map((row) => row.map((cell) => asString(cell)).join(' '))
  const headerRow = rows.slice(0, 50).find((row) => isCarrierHeaderRow(row))
  if (!headerRow) return false

  const normalizedHeader = headerRow.map((cell) => normalizeHeader(asString(cell)))
  const hasCarrierColumns =
    normalizedHeader.some((cell) => ['pod', 'port of discharge', 'disch port'].includes(cell)) ||
    normalizedHeader.some((cell) => ['description of goods', 'description', 'decription'].includes(cell)) ||
    normalizedHeader.some((cell) => ['g.w(kgs)', 'gross weight', 'gross weight(kgs)'].includes(cell))

  return hasCarrierColumns || joined.some((row) => /\b((EXPORT|CARGO)\s+)?MANIFEST\b/i.test(row))
}

function normalizePortCode(value: string) {
  const text = normalizeHeader(value)
  if (!text) return null
  if (/^[A-Z]{5}$/.test(value.trim().toUpperCase())) return value.trim().toUpperCase()
  if (text.includes('taicang')) return 'CNTAC'
  if (text.includes('zhangjiagang')) return 'CNZJG'
  if (text.includes('vitoria')) return 'BRVIX'
  if (text.includes('salvador')) return 'BRSSA'
  return value.trim().toUpperCase() || null
}

function inferPortFromText(value: string, kind: 'pol' | 'pod') {
  const text = normalizeHeader(value)
  if (kind === 'pol') {
    if (text.includes('taicang')) return 'CNTAC'
    if (text.includes('zhangjiagang')) return 'CNZJG'
  }
  if (kind === 'pod') {
    if (text.includes('vitoria')) return 'BRVIX'
    if (text.includes('salvador')) return 'BRSSA'
  }
  return null
}

function isCarrierHeaderRow(row: (string | number | null)[]) {
  const normalized = row.map((cell) => normalizeHeader(asString(cell)))
  return normalized.some((cell) => ['bl no.', 'b/l no.', 'b/l nr.', 'b/l nr'].includes(cell))
}

function findCarrierColumnIndex(row: (string | number | null)[], candidates: string[]) {
  const normalizedCandidates = candidates.map((candidate) => normalizeHeader(candidate))
  return row.findIndex((cell) => normalizedCandidates.includes(normalizeHeader(asString(cell))))
}

function collectCarrierBlRows(rawRows: (string | number | null)[][], startIndex: number, colBl: number) {
  const rows = [rawRows[startIndex] ?? []]

  for (let index = startIndex + 1; index < rawRows.length; index += 1) {
    const row = rawRows[index] ?? []
    const candidateBl = asString(colBl >= 0 ? row[colBl] : row[0])
    const joined = row.map((cell) => asString(cell)).join(' ')

    if (looksLikeCarrierBreakbulkBl(candidateBl) || /^\s*(TOTAL|MASTER OF MV)\b/i.test(joined)) break
    rows.push(row)
  }

  return rows
}

function firstValueFromColumn(rows: (string | number | null)[][], columnIndex: number) {
  if (columnIndex < 0) return null
  for (const row of rows) {
    const value = row[columnIndex]
    if (asString(value)) return value
  }
  return null
}

function joinedStringsFromColumn(rows: (string | number | null)[][], columnIndex: number) {
  if (columnIndex < 0) return ''
  return rows.map((row) => asString(row[columnIndex])).filter(Boolean).join('\n')
}

function firstNumberFromColumn(rows: (string | number | null)[][], columnIndex: number) {
  if (columnIndex < 0) return null
  for (const row of rows) {
    const number = parseNumber(row[columnIndex]) ?? parseLeadingNumber(row[columnIndex])
    if (number !== null) return number
  }
  return null
}

function findNumberBeforeUnit(rows: (string | number | null)[][], unitPattern: RegExp) {
  for (const row of rows) {
    for (let index = 1; index < row.length; index += 1) {
      if (!unitPattern.test(asString(row[index]))) continue
      const number = parseNumber(row[index - 1])
      if (number !== null) return number
    }
  }
  return null
}

function validateRequiredHeaders(rawHeaders: string[], layout: BreakbulkLayout) {
  if (layout === 'carrier') return

  const normalizedHeaders = rawHeaders.map((header) => normalizeHeader(header))
  const requiredHeaders = layout === 'summary' ? bbRequiredHeaders : legacyRequiredHeaders
  const missing = requiredHeaders.filter((label) => !normalizedHeaders.includes(normalizeHeader(label)))

  if (missing.length) {
    throw new Error(`Planilha invalida. Colunas obrigatorias: ${missing.join(', ')}.`)
  }
}

function mapRow(row: Record<string, unknown>) {
  const mapped: Partial<Record<DestinationField, unknown>> = {}

  Object.entries(row).forEach(([header, value]) => {
    const normalizedHeader = normalizeHeader(header)
    const destination = Object.entries(headerMap).find(([, candidates]) =>
      candidates.some((candidate) => normalizedHeader === normalizeHeader(candidate)),
    )?.[0] as DestinationField | undefined

    if (destination && mapped[destination] === undefined) {
      mapped[destination] = value
    }
  })

  return mapped
}

function buildBreakbulkSummaryDescription(bl: BreakbulkImportRow) {
  const parts = [
    bl.bb_machine_qty !== null ? `Maquinas: ${formatNullableNumber(bl.bb_machine_qty)}` : null,
    bl.bb_packages_qty !== null ? `Packages: ${formatNullableNumber(bl.bb_packages_qty)}` : null,
    bl.bb_packages_total !== null ? `Packages Total: ${formatNullableNumber(bl.bb_packages_total)}` : null,
  ].filter(Boolean)

  return parts.length ? parts.join(' | ') : null
}

function normalizeHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function looksLikeCarrierBreakbulkBl(value: string) {
  const text = asString(value).toUpperCase()
  return /^(?=.*[A-Z])[A-Z0-9]{8,30}$/.test(text)
}

function parseCarrierSplitPartyRows(rows: (string | number | null)[][]) {
  const parties = {
    shipper: '',
    consignee: '',
    notifyParty: '',
    cnpj: '',
  }

  for (const row of rows) {
    const marker = normalizeHeader(asString(row[1])).replace(/:$/, '')
    const value = asString(row[2])
    if (!value) continue

    if (marker === 'sh') parties.shipper = value
    if (marker === 'cn' || marker === 'co') parties.consignee = value
    if (marker === 'np' || marker === 'nf') parties.notifyParty = value
  }

  parties.cnpj = extractTaxId(parties.consignee)
  return parties
}

function parseCarrierCombinedParties(value: string) {
  const sections = {
    shipper: extractCarrierPartySection(value, /Shipper\s*\(SH\)/i, /Consignee\s*\(CO\)/i),
    consignee: extractCarrierPartySection(value, /Consignee\s*\(CO\)/i, /Notify Address\s*\(NF\)/i),
    notifyParty: extractCarrierPartySection(value, /Notify Address\s*\(NF\)/i),
  }

  return {
    ...sections,
    cnpj: extractTaxId(sections.consignee),
  }
}

function extractCarrierPartySection(value: string, startPattern: RegExp, endPattern?: RegExp) {
  const startMatch = startPattern.exec(value)
  if (!startMatch) return ''

  const startIndex = startMatch.index + startMatch[0].length
  const rest = value.slice(startIndex)
  const endMatch = endPattern?.exec(rest)
  const section = (endMatch ? rest.slice(0, endMatch.index) : rest).trim()
  return firstMeaningfulPartyLine(section) || section
}

function firstMeaningfulPartyLine(value: string) {
  return value
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => !/^(SAME AS CONSIGNEE|CNPJ[:\s]|TAX ID[:\s]|TEL[:\s]|PHONE[:\s]|FAX[:\s]|EMAIL[:\s]|E-MAIL[:\s])/i.test(line)) ?? ''
}

function parseCarrierBreakbulkParties(value: string) {
  const lines = value
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)

  const companyIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => isLikelyCompanyLine(line))

  const documents = lines
    .map((line, index) => ({ line, index, document: extractTaxId(line) }))
    .filter((entry): entry is { line: string; index: number; document: string } => Boolean(entry.document))

  const shipperIndex = companyIndexes[0]?.index ?? -1
  const shipper = companyIndexes[0]?.line ?? lines[0] ?? ''
  const consignee =
    findNearestCompanyBeforeIndex(lines, documents[0]?.index ?? -1, shipperIndex + 1) ??
    companyIndexes.find((entry) => entry.index > shipperIndex)?.line ??
    ''
  const notifyParty =
    findNearestCompanyBeforeIndex(lines, documents[1]?.index ?? -1, (documents[0]?.index ?? -1) + 1) ??
    companyIndexes.find((entry) => entry.index > (documents[0]?.index ?? shipperIndex))?.line ??
    ''

  return {
    shipper,
    consignee,
    notifyParty,
    cnpj: documents[0]?.document ?? '',
  }
}

function parseCarrierPackageInfo(value: string, explicitQty: unknown) {
  const explicit = parseNumber(explicitQty) ?? parseLeadingNumber(explicitQty)
  if (explicit !== null && explicit >= 0) {
    return {
      quantity: explicit,
      unit: 'PACKAGES',
    }
  }

  const firstLine = value
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .find(Boolean)

  const match = firstLine?.match(/^(\d+)\s+(.+)$/)
  return {
    quantity: match ? Number(match[1]) : null,
    unit: match ? match[2].trim().toUpperCase() : null,
  }
}

function parseLeadingNumber(value: unknown) {
  const text = asString(value)
  const match = text.match(/^(\d+(?:[.,]\d+)?)/)
  if (!match) return null
  return parseNumber(match[1])
}

function normalizeCarrierBreakbulkDescription(value: string) {
  const lines = value
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index) => !(index === 0 && /^\d+\s+.+$/i.test(line)))
    .filter((line) => !/^(FCL|LCL)\/(FCL|LCL)$/i.test(line))
    .filter((line) => !/^NET WEIGHT[:\s]/i.test(line))
    .filter((line) => !/^NCM NUMBER[:\s]/i.test(line))
    .filter((line) => !/^WOODEN PACKAGE[:\s]/i.test(line))
    .filter((line) => !/FREE TIME/i.test(line))

  return lines.join(' | ')
}

function extractCarrierMachineQty(value: string) {
  const normalized = value.toUpperCase()
  const hasMachineIdentifier = carrierMachineIdentifierPattern.test(normalized)
  const hasMachineNcm = extractMachineNcmCodes(value).length > 0
  const total = value
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((sum, line) => sum + extractCarrierMachineQtyFromLine(line, hasMachineIdentifier || hasMachineNcm), 0)

  if (total > 0) return total

  const identifierCount = hasMachineNcm ? countMachineModelIdentifiers(value) : 0
  return identifierCount > 0 ? identifierCount : null
}

function extractCarrierMachineQtyFromLine(value: string, hasMachineIdentifier: boolean) {
  const line = value.toUpperCase().replace(/\s+/g, ' ')
  const hasMachineKeyword = carrierMachineKeywordPattern.test(line)
  if (!hasMachineKeyword && !hasMachineIdentifier) return 0

  const unitMatch = line.match(/(?:^|\D)(\d+(?:[.,]\d+)?)\s+(?:UNITS?|MACHINES?)\b/)
  if (unitMatch) return parseNumber(unitMatch[1]) ?? 0

  if (!hasMachineKeyword) return 0

  const directEquipmentMatch = line.match(new RegExp(`(?:^|\\D)(\\d+(?:[.,]\\d+)?)\\s+(?:${carrierMachineKeywordPattern.source})\\b`))
  return directEquipmentMatch ? parseNumber(directEquipmentMatch[1]) ?? 0 : 0
}

const carrierMachineKeywordPattern =
  /\b(?:EXCAVATORS?|BUS(?:ES)?|MOBILE CRANES?|CRANES?|MOBILE JAW CRUSHERS?|JAW CRUSHERS?|CRUSHERS?|BULLDOZERS?|WHEEL LOADERS?|LOADERS?|FORKLIFTS?|DUMP TRUCKS?|TRUCKS?|CONVEYORS?|GRADERS?|ROLLERS?|TRACTORS?|DRILLING RIGS?)\b/

const carrierMachineIdentifierPattern =
  /\b(?:CHASSIS|VIN|ENGINE|FRAME|SERIAL|PRODUCT\s*ID|MACHINE\s*NO|EQUIPMENT\s*NO)\b/

const machineNcmPrefixes = [
  '8426', // guindastes, pontes rolantes e equipamentos de elevacao.
  '8427', // empilhadeiras, plataformas e veiculos de movimentacao.
  '8428', // outros equipamentos de elevacao, carga, descarga e movimentacao.
  '8429', // tratores de esteira, escavadeiras, pa carregadeiras e similares.
  '8430', // maquinas de terraplenagem, perfuracao e compactacao.
  '8474', // britadores, peneiras e maquinas para minerais.
  '8479', // maquinas e aparelhos mecanicos com funcao propria.
  '8702', // onibus e veiculos para transporte de passageiros.
  '8704', // caminhoes e veiculos para transporte de carga.
  '8705', // veiculos automoveis para usos especiais.
]

function extractMachineNcmCodes(value: string) {
  return extractNcmCodes(value).filter((code) => machineNcmPrefixes.some((prefix) => code.startsWith(prefix)))
}


function countMachineModelIdentifiers(value: string) {
  const ignoredCodes = new Set(extractNcmCodes(value))
  const matches = Array.from(value.toUpperCase().matchAll(/\b[A-Z]{2,}\d{2,}[A-Z]*-\d{2,}\b/g))
    .map((match) => match[0])
    .filter((code) => !ignoredCodes.has(code.replace(/\D/g, '')))

  return new Set(matches).size
}

function isLikelyCompanyLine(value: string) {
  const line = value.trim()
  if (!line) return false
  if (/@/.test(line)) return false
  if (/^(TEL|PHONE|FAX|MOBILE|CEP|ZIP|RUA|ROAD|NO\.|ROOM|VIA\b|POLO\b|CITY\b|STATE\b|COUNTRY\b)/i.test(line)) return false
  if (/^CNPJ[:\s]/i.test(line)) return false
  if (/\d{4,}/.test(line) && !/(LTDA|LTD|S\.A|S\/A|CO\., LTD|COMERCIO|INDUSTRIA|SERVICOS|LOGISTICA|TRANSPORTES|TRADING|IMPORTACAO|EXPORTACAO|QUIMICA)/i.test(line)) {
    return false
  }

  return /(LTDA|LTD|S\.A|S\/A|CO\., LTD|COMERCIO|INDUSTRIA|SERVICOS|LOGISTICA|TRANSPORTES|TRADING|IMPORTACAO|EXPORTACAO|QUIMICA|FLOCCULANT)/i.test(
    line,
  )
}

function findNearestCompanyBeforeIndex(lines: string[], endIndex: number, minIndex = 0) {
  if (endIndex < 0) return null

  for (let index = endIndex - 1; index >= minIndex; index -= 1) {
    if (isLikelyCompanyLine(lines[index] ?? '')) {
      return lines[index] ?? null
    }
  }

  return null
}

function extractTaxId(value: string) {
  if (!/\b(CNPJ|CPF)\b/i.test(value)) return ''

  const digits = onlyDigits(value)
  if (digits.length >= 14) return digits.slice(0, 14)
  if (digits.length >= 11 && /^CPF[:\s]/i.test(value)) return digits.slice(0, 11)
  return ''
}

function asNullableString(value: unknown) {
  const normalized = asString(value)
  return normalized ? normalized : null
}

function asNullableDigits(value: unknown) {
  const digits = onlyDigits(asString(value))
  return digits || null
}

function normalizeKey(value: unknown) {
  return asString(value).toUpperCase()
}

function nullableKey(value: unknown) {
  const normalized = normalizeKey(value)
  return normalized || null
}

function parseNumber(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  const text = asString(value)
  if (!text) return null

  if (text.includes(',') && text.includes('.')) {
    const normalized = text.replace(/\./g, '').replace(',', '.')
    const number = Number(normalized)
    return Number.isFinite(number) ? number : null
  }

  if (text.includes(',')) {
    const number = Number(text.replace(',', '.'))
    return Number.isFinite(number) ? number : null
  }

  const number = Number(text)
  return Number.isFinite(number) ? number : null
}

function formatNullableNumber(value: number | null) {
  return value === null ? '-' : Number(value).toLocaleString('pt-BR')
}
