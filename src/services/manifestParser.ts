import { normalizeText, onlyDigits, toNumber } from '../lib/utils'
import type { VoyageFormValues } from './voyages'

const headerMap = {
  bl_number: ['b/l', 'bl number', 'bill of lading', 'conhecimento'],
  shipper: ['shipper', 'embarcador', 'exportador'],
  consignee: ['consignee', 'consignatario', 'importador'],
  cnpj_cpf: ['cnpj', 'cpf', 'cnpj/cpf', 'documento'],
  pol: ['pol', 'port of loading', 'porto de embarque'],
  pod: ['pod', 'port of discharge', 'porto de destino'],
  container_number: ['container', 'cntr', 'container no', 'numero do container'],
  container_type: ['type', 'tipo', 'container type', 'cntr type'],
  gross_weight_kg: ['gross weight', 'peso bruto', 'weight', 'peso'],
  cbm: ['cbm', 'volume', 'm3'],
  seal_number: ['seal', 'lacre', 'seal no'],
  height: ['height', 'altura'],
  class: ['class', 'classe', 'imo class'],
} as const

const TARE_KG: Record<string, number> = {
  '20GP': 2230,
  '20GH': 2230,
  '40GP': 3750,
  '40HC': 3900,
  '40HQ': 3900,
  '45HC': 4800,
  '45HQ': 4800,
  '20RF': 2900,
  '40RF': 4600,
  '20FR': 2890,
  '40FR': 5500,
  '20OT': 2350,
  '40OT': 4100,
  '20FL': 2890,
  '40FL': 5500,
}

export type ParsedContainer = {
  container_number: string
  seal_number: string | null
  type: string | null
  gross_weight_kg: number | null
  cbm: number | null
  is_oog: boolean
  is_imo: boolean
  imo_class: string | null
  un_number: string | null
  tare_weight_kg?: number | null
}

export type ParsedBL = {
  id: string
  shipper: string | null
  consignee: string | null
  cnpj_cpf: string | null
  pol: string | null
  pod: string | null
  total_weight_kg: number | null
  total_cbm: number | null
  review_status: 'ok' | 'pending_review'
  review_reasons: string[]
  containers: ParsedContainer[]
}

export type ParsedManifest = {
  bls: ParsedBL[]
  rowErrors: { row: number; message: string; raw: unknown }[]
  suggestedVoyage?: Partial<VoyageFormValues>
}

type DestinationField = keyof typeof headerMap
type RawSheetRow = unknown[]

type ManifestMeta = {
  vessel: string
  voyage: string
  pol: string
  pod: string
  del: string
  dest: string
}

type ManifestLine = {
  bl: string
  shipper: string
  consignee: string
  cnpj: string
  email: string
  pol: string
  pod: string
  container: string
  seal: string
  type: string
  tare: number | null
  cocSoc: string
  fclLcl: string
  packages: string
  weight: number
  cbm: number
  imoClass: string
  unNumber: string | null
}

export async function parseManifestFile(file: File): Promise<ParsedManifest> {
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  const rawRows = XLSX.utils.sheet_to_json<RawSheetRow>(firstSheet, { header: 1, defval: '' })

  if (looksLikeCarrierManifest(rawRows)) {
    return parseCarrierManifest(rawRows)
  }

  const objectRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' })
  return parseHeaderMappedManifest(objectRows)
}

function parseHeaderMappedManifest(rows: Record<string, unknown>[]): ParsedManifest {
  const grouped = new Map<string, ParsedBL>()
  const rowErrors: ParsedManifest['rowErrors'] = []
  const allContainers = new Map<string, string>()

  rows.forEach((row, index) => {
    const mapped = mapRow(row)
    const blNumber = asString(mapped.bl_number)
    const containerNumber = asString(mapped.container_number)

    if (!blNumber) {
      rowErrors.push({ row: index + 2, message: 'Linha sem número de B/L.', raw: row })
      return
    }

    const cnpjCpf = onlyDigits(asString(mapped.cnpj_cpf))
    const grossWeight = toNumber(mapped.gross_weight_kg)
    const cbm = toNumber(mapped.cbm)
    const reasons = new Set<string>()

    if (!cnpjCpf) reasons.add('CNPJ/CPF ausente')
    if (!grossWeight || grossWeight <= 0) reasons.add('Peso zerado ou ausente')

    if (containerNumber) {
      const previousBl = allContainers.get(containerNumber)
      if (previousBl) {
        reasons.add(previousBl === blNumber ? 'Container duplicado no mesmo B/L' : 'Container duplicado em outro B/L')
      }
      allContainers.set(containerNumber, blNumber)
    }

    const existing = grouped.get(blNumber)
    const parsedContainer = containerNumber
      ? {
          container_number: containerNumber,
          seal_number: asString(mapped.seal_number) || null,
          type: asString(mapped.container_type) || null,
          gross_weight_kg: grossWeight,
          cbm,
          is_oog: Boolean(asString(mapped.height)),
          is_imo: Boolean(asString(mapped.class)),
          imo_class: asString(mapped.class) || null,
          un_number: extractUnNumber(asString(mapped.class)),
        }
      : null

    if (existing) {
      reasons.forEach((reason) => existing.review_reasons.push(reason))
      if (parsedContainer) existing.containers.push(parsedContainer)
      existing.total_weight_kg = (existing.total_weight_kg ?? 0) + (grossWeight ?? 0)
      existing.total_cbm = (existing.total_cbm ?? 0) + (cbm ?? 0)
      existing.review_reasons = Array.from(new Set(existing.review_reasons))
      existing.review_status = existing.review_reasons.length > 0 ? 'pending_review' : 'ok'
      return
    }

    const reviewReasons = Array.from(reasons)
    grouped.set(blNumber, {
      id: blNumber,
      shipper: asString(mapped.shipper) || null,
      consignee: asString(mapped.consignee) || null,
      cnpj_cpf: cnpjCpf || null,
      pol: asString(mapped.pol) || null,
      pod: asString(mapped.pod) || null,
      total_weight_kg: grossWeight,
      total_cbm: cbm,
      review_status: reviewReasons.length > 0 ? 'pending_review' : 'ok',
      review_reasons: reviewReasons,
      containers: parsedContainer ? [parsedContainer] : [],
    })
  })

  return { bls: Array.from(grouped.values()), rowErrors }
}

function parseCarrierManifest(rawRows: RawSheetRow[]): ParsedManifest {
  const meta = parseManifestHeader(rawRows)
  const grouped = new Map<string, ParsedBL>()
  const rowErrors: ParsedManifest['rowErrors'] = []
  const allContainers = new Map<string, string>()

  let currentPol = meta.pol
  let currentPod = meta.pod
  let currentDest = meta.dest
  let currentBL: {
    bl: string
    shipper: string
    consignee: string
    cnpj: string
    email: string
    pol: string
    pod: string
    dest: string
    imoClass: string
    unNumber: string | null
  } | null = null

  rawRows.forEach((row, index) => {
    const col0 = cell(row, 0)
    const col2 = cell(row, 2)
    const col4 = cell(row, 4)
    const col6 = cell(row, 6)
    const col10 = cell(row, 10)
    const weightCell = cell(row, 12)
    const cbmCell = cell(row, 14)

    if (/^POL\b/i.test(col2)) currentPol = col2.replace(/^POL\s+/i, '').trim()
    if (/^POD\b/i.test(col4)) currentPod = col4.replace(/^POD\s+/i, '').trim()
    if (/^DEST\b/i.test(col10)) currentDest = col10.replace(/^DEST\s+/i, '').trim()

    if (looksLikeBl(col0)) {
      const shipperConsigneeBlock = col6 || String(row.find((value) => /CNPJ|E-?MAIL|SAME AS CONSIGNEE/i.test(asString(value))) || '')
      const partyData = parseManifestParty(shipperConsigneeBlock)
      currentBL = {
        bl: col0,
        shipper: partyData.shipper,
        consignee: partyData.consignee,
        cnpj: partyData.cnpj,
        email: partyData.email,
        pol: currentPol,
        pod: currentPod,
        dest: currentDest,
        imoClass: extractImoClass(joinCells(row)),
        unNumber: extractUnNumber(joinCells(row)),
      }

      if (!grouped.has(currentBL.bl)) {
        const reasons = new Set<string>()
        if (!currentBL.cnpj) reasons.add('CNPJ/CPF ausente')
        if (!currentBL.email) reasons.add('E-mail ausente')

        grouped.set(currentBL.bl, {
          id: currentBL.bl,
          shipper: currentBL.shipper || null,
          consignee: currentBL.consignee || null,
          cnpj_cpf: onlyDigits(currentBL.cnpj) || null,
          pol: currentBL.pol || null,
          pod: currentBL.pod || null,
          total_weight_kg: 0,
          total_cbm: 0,
          review_status: reasons.size > 0 ? 'pending_review' : 'ok',
          review_reasons: Array.from(reasons),
          containers: [],
        })
      }

      return
    }

    if (!currentBL || !looksLikeContainerLine(col0)) return

    const line = parseManifestContainerLine(col0, currentBL.imoClass, currentBL.unNumber)
    const target = grouped.get(currentBL.bl)
    if (!target) return

    const reasons = new Set(target.review_reasons)
    if (!line.weight || line.weight <= 0) reasons.add('Peso zerado ou ausente')
    if (!line.container) reasons.add('Container ausente')

    const previousBl = allContainers.get(line.container)
    if (previousBl) {
      reasons.add(previousBl === currentBL.bl ? 'Container duplicado no mesmo B/L' : 'Container duplicado em outro B/L')
    }
    allContainers.set(line.container, currentBL.bl)

    const fallbackWeight = parseNumberValue(weightCell)
    const fallbackCbm = parseNumberValue(cbmCell)
    const grossWeight = line.weight || fallbackWeight
    const cbm = line.cbm || fallbackCbm

    target.containers.push({
      container_number: line.container,
      seal_number: line.seal || null,
      type: line.type || null,
      tare_weight_kg: line.tare,
      gross_weight_kg: grossWeight,
      cbm,
      is_oog: false,
      is_imo: Boolean(line.imoClass),
      imo_class: line.imoClass || null,
      un_number: line.unNumber,
    })

    target.total_weight_kg = (target.total_weight_kg ?? 0) + (grossWeight ?? 0)
    target.total_cbm = (target.total_cbm ?? 0) + (cbm ?? 0)
    target.review_reasons = Array.from(reasons)
    target.review_status = reasons.size > 0 ? 'pending_review' : 'ok'

    if (!line.container) {
      rowErrors.push({ row: index + 1, message: 'Linha de container sem número identificável.', raw: row })
    }
  })

  return {
    bls: Array.from(grouped.values()),
    rowErrors,
    suggestedVoyage: {
      carrierName: extractCarrierName(rawRows),
      vesselName: meta.vessel,
      voyageNumber: meta.voyage,
      polName: meta.pol,
      podName: meta.pod,
      status: 'active',
    },
  }
}

function looksLikeCarrierManifest(rawRows: RawSheetRow[]) {
  return rawRows.slice(0, 20).some((row) => joinCells(row).includes('EXPORT MANIFEST')) &&
    rawRows.slice(0, 30).some((row) => cell(row, 0) === 'BL NO.')
}

function parseManifestHeader(rawRows: RawSheetRow[]): ManifestMeta {
  const meta: ManifestMeta = {
    vessel: '',
    voyage: '',
    pol: '',
    pod: '',
    del: '',
    dest: '',
  }

  rawRows.forEach((row) => {
    row.forEach((value) => {
      const current = asString(value)
      if (!current) return

      if (!meta.vessel) meta.vessel = matchValue(current, /^VESSEL\s+(.+)$/i)
      if (!meta.voyage) meta.voyage = matchValue(current, /^VOYAGE\s+(.+)$/i)
      if (!meta.pol) meta.pol = matchValue(current, /^POL\s+(.+)$/i)
      if (!meta.pod) meta.pod = matchValue(current, /^POD\s+(.+)$/i)
      if (!meta.del) meta.del = matchValue(current, /^DEL\s+(.+)$/i)
      if (!meta.dest) meta.dest = matchValue(current, /^DEST\s+(.+)$/i)
    })
  })

  return meta
}

function extractCarrierName(rawRows: RawSheetRow[]) {
  const firstTextRow = rawRows.find((row) => cell(row, 0))
  return firstTextRow ? cell(firstTextRow, 0) : ''
}

function parseManifestParty(block: string) {
  const parts = normalizeBlock(block)
  if (!parts.length) {
    return { shipper: '', consignee: '', email: '', cnpj: '' }
  }

  const companyIndex = parts.findIndex((part) => /^(COMPANY|CONSIGNEE)\s*:/i.test(part))
  const shipper = companyIndex > 0 ? parts.slice(0, companyIndex).join(' | ') : parts[0] || ''
  const consigneeBlock = companyIndex >= 0 ? parts.slice(companyIndex) : parts

  const cnpjIndex = consigneeBlock.findIndex((part) => Boolean(extractCnpj(part)))
  if (cnpjIndex === -1) {
    return {
      shipper,
      consignee: cleanupLabel(consigneeBlock[0] || ''),
      email: consigneeBlock.map(extractEmail).find(Boolean) || '',
      cnpj: '',
    }
  }

  let nameIndex = chooseConsigneeNameIndex(consigneeBlock, cnpjIndex)
  if (nameIndex < 0) nameIndex = Math.max(0, cnpjIndex - 1)

  const consignee = cleanupLabel(consigneeBlock[nameIndex] || '')
  const cnpj = extractCnpj(consigneeBlock[cnpjIndex])
  const email = consigneeBlock.map(extractEmail).find(Boolean) || ''

  return {
    shipper,
    consignee,
    email,
    cnpj,
  }
}

function parseManifestContainerLine(value: string, fallbackImoClass: string, fallbackUnNumber: string | null): ManifestLine {
  const parts = value.split('/').map((part) => asString(part))
  const type = parts[1] || ''
  const imoClass = fallbackImoClass || ''
  const unNumber = fallbackUnNumber ?? extractUnNumber(value)

  return {
    bl: '',
    shipper: '',
    consignee: '',
    cnpj: '',
    email: '',
    pol: '',
    pod: '',
    container: parts[0] || '',
    seal: parts[2] || '',
    type,
    tare: getTare(type),
    cocSoc: parts[4] || '',
    fclLcl: parts[3] || '',
    packages: formatPackages(parts[5] || ''),
    weight: parseNumberValue(parts[6] || ''),
    cbm: parseNumberValue(parts[7] || ''),
    imoClass,
    unNumber,
  }
}

function mapRow(row: Record<string, unknown>) {
  const mapped: Partial<Record<DestinationField, unknown>> = {}

  Object.entries(row).forEach(([header, value]) => {
    const normalizedHeader = normalizeText(header)
    const destination = Object.entries(headerMap).find(([, candidates]) =>
      candidates.some((candidate) => normalizedHeader.includes(normalizeText(candidate))),
    )?.[0] as DestinationField | undefined

    if (destination && mapped[destination] === undefined) {
      mapped[destination] = value
    }
  })

  return mapped
}

function matchValue(value: string, pattern: RegExp) {
  const match = value.match(pattern)
  return match ? asString(match[1]) : ''
}

function joinCells(row: RawSheetRow) {
  return row.map(asString).filter(Boolean).join(' ')
}

function cell(row: RawSheetRow, index: number) {
  return asString(row[index])
}

function asString(value: unknown) {
  return String(value ?? '').trim()
}

function parseNumberValue(value: unknown) {
  const cleaned = asString(value).replace(/KGS?|CBM/gi, '').replace(/\s+/g, '').replace(',', '.')
  const parsed = Number.parseFloat(cleaned)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeKey(value: string) {
  return asString(value).toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function extractEmail(value: string) {
  const match = asString(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  return match ? match[0].toUpperCase() : ''
}

function extractCnpj(value: string) {
  const match = asString(value).match(/\d{2}\.?\d{3}\.?\d{3}\/\d{4}-\d{2}/)
  return match ? match[0] : ''
}

function isContactLine(value: string) {
  return /^(TEL|TELEFONE|PHONE|FAX|MOBILE|CELL|CONTACT PERSON|CONTACT|E-?MAIL|EMAIL|SITE|USCI|VAT|VAT\/TAX|TAX ID|CNPJ|CNPJ\/VAT\/TAX ID|CNPJ\/TAX ID)\b/i.test(
    asString(value),
  )
}

function isAddressLine(value: string) {
  return /^(ADD(?:RESS)?|ENDERECO|ENDERECO:|RUA|AV[.: ]|ALAMEDA|ROD[.: ]|STREET|ROAD|ROOM|SUITE|FLAT|CENTRO|CEP|ZIP|NO\.?|KM\b)/i.test(
    asString(value),
  )
}

function isLikelyCompany(value: string) {
  const text = asString(value)
  if (!text || isContactLine(text) || isAddressLine(text) || extractEmail(text) || extractCnpj(text)) return false
  return /(LTDA|LTD\.?|S\.A\.?|EIRELI|LOGISTICA|LOGISTICS|COMERCIO|COMMODITIES|SHIPPING|CARGO|PACTUAL|AGENCIAMENTO|MANAGEMENT|INTERNACIONAL|FREIGHT|PORTO|TRADING)/i.test(
    text,
  )
}

function canBeNamePart(value: string) {
  const text = asString(value)
  return Boolean(text) && !isContactLine(text) && !isAddressLine(text) && !extractEmail(text) && !extractCnpj(text)
}

function chooseConsigneeNameIndex(parts: string[], cnpjIndex: number) {
  let bestIndex = -1
  let bestScore = Number.NEGATIVE_INFINITY

  for (let index = 0; index < cnpjIndex; index += 1) {
    const current = parts[index]
    if (!canBeNamePart(current)) continue

    const distance = cnpjIndex - index
    let score = Math.max(0, 12 - distance * 2)
    if (isLikelyCompany(current)) score += 5
    if (distance <= 2) score += 4
    if (distance <= 4) score += 2

    const nextParts = parts.slice(index + 1, Math.min(cnpjIndex, index + 4))
    if (nextParts.some(isAddressLine)) score += 2
    if (nextParts.some((part) => /BRAZIL|BRASIL|CEP\b|CNPJ\b|E-?MAIL\b/i.test(part))) score += 2

    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  }

  return bestIndex
}

function normalizeBlock(value: string) {
  return asString(value)
    .split(/\n|\|/g)
    .map((part) => asString(part))
    .filter(Boolean)
    .filter((part) => !/^SAME AS CONSIGNEE$/i.test(part))
}

function cleanupLabel(value: string) {
  return asString(value).replace(/^(COMPANY|CONSIGNEE|SHIPPER|NOTIFY PARTY|NAME)\s*:\s*/i, '')
}

function formatPackages(value: string) {
  const compact = asString(value).replace(/\s+/g, '')
  const match = compact.match(/^([\d.,]+)([A-Z].*)$/i)
  if (!match) return asString(value).toUpperCase()
  return `${match[1]} ${match[2].toUpperCase()}`.trim()
}

function looksLikeBl(value: string) {
  return /^[A-Z]{3,5}[A-Z0-9]{7,}$/.test(asString(value))
}

function looksLikeContainerLine(value: string) {
  return /^[A-Z]{4}\d{7}\/[A-Z0-9]{2,}/.test(asString(value))
}

function getTare(type: string) {
  const key = normalizeKey(type)
  if (TARE_KG[key]) return TARE_KG[key]
  if (key.startsWith('20')) return 2300
  if (key.startsWith('40')) return 3900
  if (key.startsWith('45')) return 4800
  return null
}

function extractImoClass(value: string) {
  const normalized = asString(value)
  const match = normalized.match(/(?:DG CLASS|IMO CLASS|CLASS)\s*[:.]?\s*([0-9.]+)/i)
  return match?.[1] ?? ''
}

function extractUnNumber(value: string) {
  const match = asString(value).match(/UN(?:\s*NCM\.?|)\s*[:.]?\s*(\d{4})/i)
  return match?.[1] ?? null
}
