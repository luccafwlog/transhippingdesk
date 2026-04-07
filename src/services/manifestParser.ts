import { normalizeText, onlyDigits, toNumber } from '../lib/utils'

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
  rowErrors: { row: number; message: string; raw: Record<string, unknown> }[]
}

type DestinationField = keyof typeof headerMap

export async function parseManifestFile(file: File): Promise<ParsedManifest> {
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' })
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

function asString(value: unknown) {
  return String(value ?? '').trim()
}

function extractUnNumber(value: string) {
  const match = value.match(/UN\s?(\d{4})/i)
  return match?.[1] ?? null
}
