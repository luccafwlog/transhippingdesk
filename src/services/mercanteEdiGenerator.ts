import { extractNcmCodes } from '../lib/ncm'
import type { BL, BLContainer, Voyage, Vessel, Port } from '../types/database'

// ponytail: port-to-UF mapping for known Brazilian discharge ports
export function portNameToUf(name: string): string {
  const map: Record<string, string> = {
    salvador: 'BA',
    vitoria: 'ES',
    santos: 'SP',
    'rio de janeiro': 'RJ',
    paranagua: 'PR',
    itajai: 'SC',
    navegantes: 'SC',
    'sao francisco do sul': 'SC',
    'rio grande': 'RS',
    suape: 'PE',
    pecem: 'CE',
    manaus: 'AM',
    'vila do conde': 'PA',
    itaqui: 'MA',
    'sao luis': 'MA',
    'porto alegre': 'RS',
    aratu: 'BA',
    ilheus: 'BA',
    fortaleza: 'CE',
    natal: 'RN',
    cabedelo: 'PB',
    maceio: 'AL',
    aracaju: 'SE',
  }
  return map[name.toLowerCase().trim()] ?? ''
}

// ponytail: UN/LOCODE corrections where carrier manifests use a non-standard
// code that Mercante rejects. TAICANG (China) is printed as CNTAC by COSCO but
// its registered UN/LOCODE — and the only value Mercante accepts — is CNTAG.
// Upgrade path: move to a port-aliases table once more corrections appear.
const LOCODE_ALIASES: Record<string, string> = {
  CNTAC: 'CNTAG',
}

export function normalizeMercanteLocode(locode: string): string {
  const code = (locode ?? '').toUpperCase().trim()
  return LOCODE_ALIASES[code] ?? code
}

// ISO 6346 size/type codes. Carrier manifests print human types (20GP, 40HC);
// Mercante requires the ISO code (22G1, 45G1). Pass through values that already
// look like ISO codes (NNAN). ponytail: covers the common dry/reefer/special
// types seen in COSCO manifests; extend the map as new types appear.
const ISO_CONTAINER_TYPE: Record<string, string> = {
  '20': '22G1', '20GP': '22G1', '20DV': '22G1', '22G0': '22G1',
  '20HC': '25G1', '20HQ': '25G1',
  '40': '42G1', '40GP': '42G1', '40DV': '42G1', '42G0': '42G1',
  '40HC': '45G1', '40HQ': '45G1', '45HC': '45G1', '45': '45G1', '45G0': '45G1',
  '20RF': '22R1', '20RH': '22R1', '40RF': '45R1', '40RH': '45R1', '40RFHC': '45R1',
  '20OT': '22U1', '40OT': '42U1',
  '20FR': '22P1', '40FR': '42P1',
  '20TK': '22T1', '20TN': '22T1',
  '20PL': '22P1', '40PL': '42P1',
}

export function toIsoContainerType(type: string): string {
  const t = (type ?? '').toUpperCase().replace(/\s+/g, '').trim()
  if (ISO_CONTAINER_TYPE[t]) return ISO_CONTAINER_TYPE[t]
  if (/^[0-9]{2}[A-Z][0-9]$/.test(t)) return t
  return t.slice(0, 4)
}

export type MercanteFreightLine = {
  code: string
  valueCents: number
  type: string
}

export type MercanteManifestData = {
  shippingCompanyCode: string
  agencyCnpj: string
  voyageNumber: string
  vesselImo: string
  polLocode: string
  podLocode: string
  terminalCode: string
  /** Discharge/arrival date at POD (YYYYMMDD or YYYY-MM-DD). */
  operationDate: string
  /** Manifest closing / loading date at POL (YYYYMMDD or YYYY-MM-DD). */
  closingDate: string
  bls: MercanteBlData[]
}

export type MercanteBlData = {
  blNumber: string
  consigneeCnpjCpf: string
  consigneeName: string
  /** Full consignee block (name + address + email), one item per line. */
  consigneeBlock: string
  consigneeAddress: string
  shipperName: string
  /** Full shipper block (name + address + contacts), one item per line. */
  shipperBlock: string
  /** Notify party CNPJ/CPF (digits only). */
  notifyCnpjCpf: string
  /** Full notify-party block (name + address). */
  notifyBlock: string
  /** Second notify party ("ALSO NOTIFY"), appended to the description. */
  notify2Block: string
  /** Consignee phone, appended to the description after the "**" marker. */
  consigneePhone: string
  cargoDescription: string
  totalPackages: number
  /** Package unit label for the description trailer (e.g. FLEXITANK). */
  packagesUnit: string
  totalWeightKg: number
  totalCbm: number
  polLocode: string
  podLocode: string
  countryOfOrigin: string
  destinationUf: string
  /** Discharge terminal code (e.g. BRSSA002), echoed into the C5 tail block. */
  terminalCode: string
  paymentType: string
  freightLines: MercanteFreightLine[]
  containers: MercanteContainerData[]
}

export type MercanteContainerData = {
  containerNumber: string
  sealNumber: string
  containerType: string
  tareWeightKg: number
  grossWeightKg: number
  totalCbm: number
  ncmCodes: string[]
  isImo: boolean
  imoClass: string
  unNumber: string
}

// --- formatting helpers -----------------------------------------------------

/** Strip /,- and collapse whitespace — used for structured party fields. */
function cleanParty(value: string): string {
  return (value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[/-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Collapse whitespace only — used for the free-text description. */
function cleanText(value: string): string {
  return (value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function digits(value: string): string {
  return (value ?? '').replace(/\D/g, '')
}

function fmtDate(value: string): string {
  return (value ?? '').replace(/\D/g, '').slice(0, 8)
}

/** Right-justified zero-padded integer of a kg/unit value (no decimals). */
function fmtNum(value: number | string, length: number): string {
  const str = typeof value === 'number' ? String(Math.round(value)) : digits(value)
  return str.slice(-length).padStart(length, '0')
}

/** Right-justified fixed-decimal value (e.g. 26.0 -> "0000000026000"). */
function fmtNumDec(value: number, length: number, decimals: number): string {
  const intVal = Math.round((value || 0) * 10 ** decimals)
  return String(intVal).slice(-length).padStart(length, '0')
}

/** Place `value` (left-justified) into a fixed-size record buffer. */
function place(buf: string[], start: number, value: string, width: number): void {
  const v = (value ?? '').replace(/[\r\n]/g, '').slice(0, width)
  for (let i = 0; i < v.length; i++) buf[start + i] = v[i]
}

function newBuffer(length: number): string[] {
  return new Array<string>(length).fill(' ')
}

// --- record offsets (validated against FWL_MERCANTE reference) --------------

const M5_LEN = 164
const C5_LEN = 4104
const I5_LEN = 5000

// --- M5: manifest header ----------------------------------------------------

export function generateM5Record(data: MercanteManifestData): string {
  const buf = newBuffer(M5_LEN)
  place(buf, 0, 'M5', 2)
  place(buf, 2, fmtNum(data.bls.length, 4), 4)
  // [6,10) qtde vazios — left blank
  place(buf, 10, data.shippingCompanyCode, 14)
  place(buf, 24, data.agencyCnpj, 14)
  place(buf, 38, fmtDate(data.closingDate), 8) // encerramento / POL loading
  place(buf, 46, fmtDate(data.operationDate), 8) // descarga / POD arrival
  place(buf, 54, normalizeMercanteLocode(data.polLocode), 5)
  place(buf, 59, normalizeMercanteLocode(data.podLocode), 5)
  place(buf, 64, data.voyageNumber, 10)
  place(buf, 74, digits(data.vesselImo), 10)
  // [84,124) reserved — left blank
  place(buf, 124, data.terminalCode, 40)
  return buf.join('')
}

// --- C5: conhecimento (one per B/L) -----------------------------------------

function buildDescription(bl: MercanteBlData, emissionDate: string): string {
  const parts: string[] = []
  const desc = cleanText(bl.cargoDescription)
  if (desc) parts.push(desc)
  if (bl.consigneePhone) parts.push(`**${cleanText(bl.consigneePhone)}`)
  const notify2 = cleanText(bl.notify2Block)
  if (notify2) parts.push(`ALSO NOTIFY:${notify2}`)
  if (bl.totalPackages > 0 && bl.packagesUnit) {
    const unit = bl.packagesUnit.toUpperCase()
    const plural = unit.endsWith('S') ? unit : `${unit}S`
    parts.push(`TOTAL: ${bl.totalPackages} ${plural}`)
  }
  return `${fmtDate(emissionDate)}${parts.join(' ')}`
}

export function generateC5Record(bl: MercanteBlData, emissionDate?: string): string {
  const buf = newBuffer(C5_LEN)
  place(buf, 0, 'C5', 2)
  place(buf, 2, fmtNum(bl.containers.length, 4), 4)
  place(buf, 6, bl.blNumber, 18)
  place(buf, 24, 'N', 1)
  place(buf, 25, 'N', 1)
  place(buf, 28, 'N', 1)

  // Consignee: full block, /,- stripped, "**" terminator.
  const consigneeBlock = bl.consigneeBlock || [bl.consigneeName, bl.consigneeAddress].filter(Boolean).join(' ')
  place(buf, 29, `${cleanParty(consigneeBlock)}**`, 253)
  place(buf, 367, digits(bl.consigneeCnpjCpf), 14)

  // Shipper: full block, /,- stripped.
  const shipperBlock = bl.shipperBlock || bl.shipperName
  place(buf, 381, cleanParty(shipperBlock), 253)

  // Emission date + assembled description (date occupies first 8 chars).
  place(buf, 634, buildDescription(bl, emissionDate ?? ''), 759)

  // Cargo cube (m³ × 1000), route, notify party.
  place(buf, 1401, fmtNumDec(bl.totalCbm, 13, 3), 13)
  place(buf, 1414, normalizeMercanteLocode(bl.polLocode), 5)
  place(buf, 1419, normalizeMercanteLocode(bl.podLocode), 5)
  place(buf, 1424, digits(bl.notifyCnpjCpf), 14)
  place(buf, 1438, cleanParty(bl.notifyBlock), 301)

  // ponytail: pos 1739 holds a computed value from the source system that does
  // not correlate with weight/CBM/packages in the reference; left as zeros.
  place(buf, 1739, fmtNum(0, 17), 17)

  // Constant terminal/UF/flag block (parameterised by UF + terminal).
  place(buf, 1756, '0000220PHHI', 11)
  place(buf, 1767, bl.destinationUf, 2)
  place(buf, 1769, bl.terminalCode, 8)
  place(buf, 1777, 'CNN', 3)
  place(buf, 1780, fmtNum(0, 15), 15)

  // Freight block: 15 units of [code(5)][value(14, 2dp)][type(1)] from 3796.
  for (let i = 0; i < 15; i++) {
    const off = 3796 + i * 20
    const line = bl.freightLines[i]
    if (line) {
      place(buf, off, fmtNum(line.code, 5), 5)
      place(buf, off + 5, fmtNum(line.valueCents, 14), 14)
      place(buf, off + 19, line.type, 1)
    } else {
      place(buf, off, fmtNum(0, 19), 19)
    }
  }

  return buf.join('')
}

// --- I5: item de carga (one per container) ----------------------------------

export function generateI5Record(container: MercanteContainerData, seq: number): string {
  const buf = newBuffer(I5_LEN)
  place(buf, 0, 'I5', 2)
  place(buf, 2, '1', 1)
  place(buf, 3, fmtNum(seq, 4), 4)
  place(buf, 7, fmtNumDec(container.grossWeightKg, 12, 3), 12)
  place(buf, 19, toIsoContainerType(container.containerType), 4)
  place(buf, 23, container.containerNumber, 11)
  place(buf, 34, fmtNumDec(container.tareWeightKg, 9, 3), 9)

  // ponytail: IMO/UN placement unverified — the reference manifest has no
  // dangerous cargo. UN number + class written into the reserved [447,458)
  // slot; confirm against an IMO manifest before relying on it.
  if (container.isImo) {
    place(buf, 447, digits(container.unNumber), 4)
    place(buf, 451, container.imoClass, 4)
  }

  place(buf, 458, fmtNumDec(container.totalCbm ?? 0, 13, 3), 13)
  place(buf, 471, digits(container.sealNumber), 6)

  // NCM codes: 4-digit code every 8 chars from offset 531.
  container.ncmCodes.slice(0, 6).forEach((ncm, i) => {
    place(buf, 531 + i * 8, digits(ncm), 4)
  })

  return buf.join('')
}

export function generateEdiMercante(data: MercanteManifestData): string {
  const lines: string[] = []
  lines.push(generateM5Record(data))

  for (const bl of data.bls) {
    lines.push(generateC5Record(bl, data.operationDate))
    bl.containers.forEach((ctr, idx) => {
      lines.push(generateI5Record(ctr, idx + 1))
    })
  }

  return lines.join('\r\n')
}

// --- mapping from DB rows ----------------------------------------------------

// Columns added by migration 161 to capture the full positional party blocks.
// Typed as an optional extension so the generator compiles before the generated
// `database.ts` types are regenerated, and degrades gracefully pre-migration.
export type MercanteBlSource = BL &
  Partial<{
    consignee_block: string | null
    consignee_address: string | null
    consignee_phone: string | null
    shipper_block: string | null
    notify_cnpj_cpf: string | null
    notify_block: string | null
    notify2_block: string | null
    total_packages: number | null
    packages_unit: string | null
  }>

export function blToMercanteBlData(bl: MercanteBlSource, containers: BLContainer[]): MercanteBlData {
  return {
    blNumber: bl.id,
    consigneeCnpjCpf: bl.manifest_customer_cnpj_cpf ?? '',
    consigneeName: bl.manifest_customer_name ?? bl.consignee ?? '',
    consigneeBlock: bl.consignee_block ?? bl.manifest_customer_name ?? bl.consignee ?? '',
    consigneeAddress: bl.consignee_address ?? '',
    shipperName: bl.shipper ?? '',
    shipperBlock: bl.shipper_block ?? bl.shipper ?? '',
    notifyCnpjCpf: bl.notify_cnpj_cpf ?? '',
    notifyBlock: bl.notify_block ?? bl.notify_party ?? '',
    notify2Block: bl.notify2_block ?? '',
    consigneePhone: bl.consignee_phone ?? '',
    cargoDescription: bl.cargo_description ?? '',
    totalPackages: bl.total_packages ?? 0,
    packagesUnit: bl.packages_unit ?? '',
    totalWeightKg: bl.total_weight_kg ?? 0,
    totalCbm: bl.total_cbm ?? 0,
    polLocode: bl.pol ?? '',
    podLocode: bl.pod ?? '',
    countryOfOrigin: (bl.pol ?? '').slice(0, 2),
    destinationUf: '',
    terminalCode: '',
    paymentType: bl.payment_type ?? '',
    freightLines: [],
    containers: containers.map((c) => ({
      containerNumber: c.container_number,
      sealNumber: c.seal_number ?? '',
      containerType: c.type ?? '',
      tareWeightKg: c.tare_weight_kg ?? 0,
      grossWeightKg: c.gross_weight_kg ?? 0,
      totalCbm: c.cbm ?? 0,
      ncmCodes: extractNcmCodes(bl.cargo_description ?? ''),
      isImo: c.is_imo ?? false,
      imoClass: c.imo_class ?? '',
      unNumber: c.un_number ?? '',
    })),
  }
}

export function buildManifestData(params: {
  shippingCompanyCode: string
  agencyCnpj: string
  terminalCode: string
  /** Loading/closing date at POL (manifest header SAILED). */
  loadingDate: string
  /** Discharge/arrival date at POD. */
  dischargeDate: string
  voyage: Voyage
  vessel: Vessel
  polPort: Port | null
  podPort: Port | null
  bls: BL[]
  blContainers: Map<string, BLContainer[]>
}): MercanteManifestData {
  const podUf = portNameToUf(params.podPort?.name ?? '')
  const polLocode = normalizeMercanteLocode(params.polPort?.locode ?? '')
  const podLocode = normalizeMercanteLocode(params.podPort?.locode ?? '')
  const blData = params.bls.map((bl) => {
    const bd = blToMercanteBlData(bl, params.blContainers.get(bl.id) ?? [])
    bd.destinationUf = podUf
    bd.polLocode = polLocode
    bd.podLocode = podLocode
    bd.countryOfOrigin = polLocode.slice(0, 2)
    bd.terminalCode = params.terminalCode
    return bd
  })

  return {
    shippingCompanyCode: params.shippingCompanyCode,
    agencyCnpj: params.agencyCnpj,
    voyageNumber: params.voyage.voyage_number,
    vesselImo: params.vessel.imo ?? '',
    polLocode,
    podLocode,
    terminalCode: params.terminalCode,
    operationDate: params.dischargeDate,
    closingDate: params.loadingDate,
    bls: blData,
  }
}
