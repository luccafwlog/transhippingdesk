import { assertUploadSize } from '../lib/fileGuard'
import { asString, onlyDigits, toNumber } from '../lib/utils'
import { normalizeIsoContainerNumber } from '../lib/containerNumber'

export type BLFreightCharge = {
  description: string
  rateCurrency: string | null
  rateAmount: number | null
  per: string | null
  currency: string | null
  amount: number | null
  payment: 'PREPAID' | 'COLLECT' | null
}

export type ParsedBLContainer = {
  containerNumber: string
  sealNumber: string | null
  tareKg: number | null
  ownership: string | null
  packages: string | null
  type: string | null
  grossWeightKg: number | null
  cbm: number | null
}

export type ParsedBLVehicle = {
  chassis: string
  containerNumber: string | null
  blNumber: string | null
}

export type ParsedBLDocument = {
  blNumber: string
  parties: {
    shipperBlock: string
    consigneeBlock: string
    consigneeTaxId: string | null
    notifyBlock: string
    alsoNotifyBlock: string
  }
  route: {
    receipt: string
    pol: string
    pod: string
    delivery: string
    vessel: string
    voyage: string
    movementFrom: string
    movementTo: string
  }
  dates: {
    ladenOnBoard: string
    issueDate: string
    issuePlace: string
  }
  containers: ParsedBLContainer[]
  vehicles: ParsedBLVehicle[]
  freightCharges: BLFreightCharge[]
}

type RawSheetRow = unknown[]

export async function parseBLFile(file: File): Promise<ParsedBLDocument> {
  assertUploadSize(file)
  const buffer = await file.arrayBuffer()
  return parseBLBuffer(buffer)
}

export async function parseBLBuffer(buffer: ArrayBuffer): Promise<ParsedBLDocument> {
  const XLSX = await import('@e965/xlsx')
  const workbook = XLSX.read(buffer, { type: 'array' })
  // ponytail: acoplado ao layout COSCO Page 1; upgrade = detectar layout por armador/template.
  const page1 = workbook.Sheets['Page 1'] ?? workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<RawSheetRow>(page1, { header: 1, defval: '' })
  const vesselVoyage = parseVesselVoyage(cell(rows, 18, 'A'))

  return {
    blNumber: cell(rows, 6, 'AC'),
    parties: {
      shipperBlock: cell(rows, 6, 'A'),
      consigneeBlock: cell(rows, 10, 'A'),
      consigneeTaxId: extractTaxId(cell(rows, 10, 'A')),
      notifyBlock: cell(rows, 14, 'A'),
      alsoNotifyBlock: cell(rows, 14, 'T'),
    },
    route: {
      receipt: cell(rows, 16, 'G'),
      pol: cell(rows, 18, 'G'),
      pod: cell(rows, 20, 'A'),
      delivery: cell(rows, 20, 'G'),
      vessel: vesselVoyage.vessel,
      voyage: vesselVoyage.voyage,
      movementFrom: cell(rows, 20, 'T'),
      movementTo: cell(rows, 20, 'AC'),
    },
    dates: {
      ladenOnBoard: cell(rows, 35, 'AB'),
      issueDate: cell(rows, 38, 'A'),
      issuePlace: cell(rows, 38, 'E'),
    },
    containers: parseContainers(rows),
    vehicles: parseVehicles(workbook, XLSX.utils),
    freightCharges: parseFreightCharges(rows),
  }
}

function parseFreightCharges(rows: RawSheetRow[]): BLFreightCharge[] {
  const charges: BLFreightCharge[] = []

  for (let rowIndex = 25; rowIndex < 46; rowIndex += 1) {
    const row = rows[rowIndex]
    const description = cellValue(row, 0)
    if (!description) {
      continue
    }

    const rateText = cellValue(row, 7)
    const per = cellValue(row, 11) || null
    const prepaid = cellValue(row, 22)
    const collect = cellValue(row, 23)
    const amount = cellValue(row, 15)
    if (!rateText && !per && !amount && !prepaid && !collect) continue

    const rate = parseMoney(rateText)
    const amountText = amount || prepaid || collect || rateText
    const money = parseMoney(amountText)

    charges.push({
      description,
      rateCurrency: rate.currency,
      rateAmount: rate.amount,
      per,
      currency: money.currency,
      amount: money.amount,
      payment: prepaid ? 'PREPAID' : collect ? 'COLLECT' : null,
    })
  }

  return charges
}

function parseContainers(rows: RawSheetRow[]): ParsedBLContainer[] {
  const containers: ParsedBLContainer[] = []
  const seen = new Set<string>()

  for (let rowIndex = 46; rowIndex < rows.length; rowIndex += 1) {
    const line = cellValue(rows[rowIndex], 0)
    if (!line) continue

    const parts = line.split('/').map((part) => part.trim())
    const containerNumber = normalizeIsoContainerNumber(parts[0])
    if (!containerNumber || seen.has(containerNumber)) continue
    seen.add(containerNumber)

    containers.push({
      containerNumber,
      sealNumber: parts[1] || null,
      tareKg: parseNumber(parts[2]),
      ownership: parts[3] || null,
      packages: parts[4] || null,
      type: parts[5] || null,
      grossWeightKg: parseNumber(parts[6]),
      cbm: parseNumber(parts[7]),
    })
  }

  return containers
}

function parseVehicles(workbook: { Sheets: Record<string, unknown> }, utils: typeof import('@e965/xlsx').utils) {
  const vinSheetName = Object.keys(workbook.Sheets).find((name) => name.trim().toUpperCase() === 'VIN')
  const vinSheet = vinSheetName ? workbook.Sheets[vinSheetName] : null
  if (!vinSheet) return []

  const rows = utils.sheet_to_json<Record<string, unknown>>(vinSheet, { defval: '' })
  return rows.flatMap((row) => {
    const chassis = findHeaderValue(row, ['CHASSIS', 'CHASSI', 'VIN'])
    if (!chassis) return []

    return [{
      chassis,
      containerNumber: findHeaderValue(row, ['CONTAINERNO']) || null,
      blNumber: findHeaderValue(row, ['BLNO', 'BL']) || null,
    }]
  })
}

function findHeaderValue(row: Record<string, unknown>, names: string[]) {
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = key.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (names.includes(normalizedKey)) return asString(value)
  }
  return ''
}

function parseVesselVoyage(value: string) {
  const match = value.match(/^(.+)\s+([A-Z0-9-]+)$/i)
  return {
    vessel: match ? match[1].trim() : value,
    voyage: match ? match[2].trim() : '',
  }
}

function parseMoney(value: string) {
  const currency = value.match(/\b[A-Z]{3}\b/i)?.[0]?.toUpperCase() ?? null
  return { currency, amount: parseNumber(value) }
}

function parseNumber(value: unknown) {
  return toNumber(value)
}

export function extractTaxId(value: string) {
  const digits = onlyDigits(value)
  return digits.length >= 14 ? digits.slice(0, 14) : digits || null
}

function cell(rows: RawSheetRow[], rowNumber: number, column: string) {
  return cellValue(rows[rowNumber - 1], columnIndex(column))
}

function cellValue(row: RawSheetRow | undefined, index: number) {
  return asString(row?.[index])
}

function columnIndex(column: string) {
  return column.split('').reduce((index, char) => index * 26 + char.charCodeAt(0) - 64, 0) - 1
}
