import { asString, onlyDigits } from '../lib/utils'
import { findMatchedCustomer, loadCustomerMaps } from './customerReconciliation'
import { calculateBlLocalCharges } from './localCharges'
import { supabase } from './supabase'

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
  const buffer = await file.arrayBuffer()
  return parseBreakbulkManifestBuffer(buffer)
}

export async function parseBreakbulkManifestBuffer(buffer: ArrayBuffer): Promise<ParsedBreakbulkManifest> {
  const XLSX = await import('xlsx')
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

  const { data: batch, error: batchError } = await supabase
    .from('import_batches')
    .insert({
      filename,
      voyage_id: voyageId,
      cargo_mode: 'carga_solta',
      uploaded_by: uploadedBy,
      status: 'processing',
      total_bls: manifest.bls.length,
      total_containers: 0,
      error_count: manifest.rowErrors.length,
    })
    .select()
    .single()

  if (batchError) throw batchError

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
        batch_id: batch.id,
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

  if (blRows.length) {
    const { error } = await supabase.from('bls').upsert(blRows, { onConflict: 'id' })
    if (error) throw error

    const validBlIds = blRows.map((row) => row.id)
    const { error: deleteError } = await supabase.from('bl_breakbulk_items').delete().in('bl_id', validBlIds)
    if (deleteError) throw deleteError

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

    if (itemRows.length) {
      const { error: insertItemsError } = await supabase.from('bl_breakbulk_items').insert(itemRows)
      if (insertItemsError) throw insertItemsError
    }
  }

  if (importErrors.length) {
    const rows = importErrors.map((rowError) => ({
      batch_id: batch.id,
      row_number: rowError.row > 0 ? rowError.row : null,
      bl_number:
        typeof rowError.raw === 'object' && rowError.raw && 'bl_id' in rowError.raw
          ? String((rowError.raw as { bl_id?: unknown }).bl_id ?? '')
          : null,
      error_type: 'parser',
      error_message: rowError.message,
      raw_data: rowError.raw,
    }))
    const { error } = await supabase.from('import_errors').insert(rows)
    if (error) throw error
  }

  const { error: updateError } = await supabase
    .from('import_batches')
    .update({ status: importErrors.length ? 'partial' : 'completed' })
    .eq('id', batch.id)
  if (updateError) throw updateError

  // Dispara cálculo de taxas locais em background para os BLs importados com sucesso.
  const validBlIds = blRows.map((row) => row.id)
  if (validBlIds.length) {
    void triggerLocalChargesForBls(validBlIds, uploadedBy)
  }

  return batch.id
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

  let currentPol = ''
  let currentPod = ''

  rawRows.forEach((row, index) => {
    const col0 = asString(row[0])
    const col2 = asString(row[2])
    const col4 = asString(row[4])

    if (/^POL\b/i.test(col2)) currentPol = col2.replace(/^POL\s+/i, '').trim()
    if (/^POD\b/i.test(col4)) currentPod = col4.replace(/^POD\s+/i, '').trim()

    if (!looksLikeCarrierBreakbulkBl(col0)) return

    const descriptionBlock = asString(row[3])
    const parties = parseCarrierBreakbulkParties(asString(row[6]))
    const grossWeightKg = parseNumber(row[11]) ?? 0
    const cbm = parseNumber(row[13]) ?? 0
    const packageInfo = parseCarrierPackageInfo(descriptionBlock)
    const itemDescription = normalizeCarrierBreakbulkDescription(descriptionBlock)

    if (!parties.consignee) {
      rowErrors.push({
        row: index + 1,
        message: `Consignatario nao identificado para o BL ${col0}.`,
        raw: row,
      })
    }

    bls.push({
      rowNumber: index + 1,
      bl_id: col0,
      ce_mercante: null,
      shipper: parties.shipper || null,
      consignee: parties.consignee || 'CONSIGNATARIO NAO IDENTIFICADO',
      notify_party: parties.notifyParty || null,
      cnpj_cpf: parties.cnpj || null,
      pol: currentPol || null,
      pod: currentPod || null,
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
          marks: asNullableString(row[1]),
        },
      ],
    })
  })

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
  const joined = rows.slice(0, 20).map((row) => row.map((cell) => asString(cell)).join(' '))
  return (
    joined.some((row) => row.includes('EXPORT MANIFEST')) &&
    rows.slice(0, 20).some((row) => asString(row[0]) === 'BL NO.')
  )
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
    .toLowerCase()
}

function looksLikeCarrierBreakbulkBl(value: string) {
  return /^[A-Z]{3,5}[A-Z0-9]{7,}$/.test(asString(value))
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

function parseCarrierPackageInfo(value: string) {
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
  const match = value.match(/(\d+)\s+MACHINES?/i)
  return match ? Number(match[1]) : null
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

function chunkArray<T>(values: T[], chunkSize: number) {
  if (!values.length) return []
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize))
  }
  return chunks
}
