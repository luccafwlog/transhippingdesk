import { normalizeText } from '../lib/utils'
import { supabase } from './supabase'

const headerMap = {
  bl_id: ['bl', 'b/l', 'bill of lading'],
  container_number: ['container', 'container number', 'numero do container'],
  is_imo: ['imo'],
  is_oog: ['oog'],
} as const

const requiredHeaders = {
  bl_id: 'BL',
  container_number: 'Container',
  is_imo: 'IMO',
  is_oog: 'OOG',
} as const

type DestinationField = keyof typeof headerMap

export type ContainerFlagsImportRow = {
  bl_id: string
  container_number: string
  is_imo: boolean
  imo_class: string | null
  un_number: string | null
  imo_value: string | null
  is_oog: boolean
}

export type ParsedContainerFlagsImport = {
  rows: ContainerFlagsImportRow[]
  rowErrors: { row: number; message: string; raw: unknown }[]
}

export async function parseContainerFlagsImportFile(file: File): Promise<ParsedContainerFlagsImport> {
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]

  if (!firstSheet) {
    throw new Error('Arquivo sem abas validas.')
  }

  const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(firstSheet, {
    header: 1,
    defval: '',
    blankrows: false,
  })

  const rawHeaders = (matrix[0] ?? []).map((cell) => String(cell ?? '').trim())
  validateRequiredHeaders(rawHeaders)

  const objectRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' })
  return parseContainerFlagsImportRows(objectRows)
}

export async function importContainerFlagsRows(rows: ContainerFlagsImportRow[]) {
  const uniqueRows = Array.from(
    new Map(rows.map((row) => [makeContainerKey(row.bl_id, row.container_number), row])).values(),
  )

  if (!uniqueRows.length) {
    return { updated: 0, unchanged: 0, missing: 0 }
  }

  const blIds = Array.from(new Set(uniqueRows.map((row) => row.bl_id)))
  const { data: existingContainers, error } = await supabase
    .from('bl_containers')
    .select('id, bl_id, container_number, is_imo, imo_class, un_number, is_oog')
    .in('bl_id', blIds)

  if (error) throw error

  const containersByKey = new Map<string, Array<(typeof existingContainers)[number]>>()
  for (const container of existingContainers ?? []) {
    const key = makeContainerKey(container.bl_id ?? '', container.container_number)
    const current = containersByKey.get(key) ?? []
    current.push(container)
    containersByKey.set(key, current)
  }

  let updated = 0
  let unchanged = 0
  let missing = 0

  for (const row of uniqueRows) {
    const matches = containersByKey.get(makeContainerKey(row.bl_id, row.container_number))
    if (!matches?.length) {
      missing += 1
      continue
    }

    const idsToUpdate = matches
      .filter(
        (container) =>
          Boolean(container.is_imo) !== row.is_imo ||
          Boolean(container.is_oog) !== row.is_oog ||
          normalizeValue(container.imo_class) !== normalizeValue(row.imo_class) ||
          normalizeValue(container.un_number) !== normalizeValue(row.un_number),
      )
      .map((container) => container.id)

    if (!idsToUpdate.length) {
      unchanged += 1
      continue
    }

    const { error: updateError } = await supabase
      .from('bl_containers')
      .update({
        is_imo: row.is_imo,
        imo_class: row.is_imo ? row.imo_class : null,
        un_number: row.is_imo ? row.un_number : null,
        is_oog: row.is_oog,
      })
      .in('id', idsToUpdate)

    if (updateError) throw updateError
    updated += 1
  }

  return { updated, unchanged, missing }
}

function parseContainerFlagsImportRows(rows: Record<string, unknown>[]): ParsedContainerFlagsImport {
  const parsedRows: ContainerFlagsImportRow[] = []
  const rowErrors: ParsedContainerFlagsImport['rowErrors'] = []

  rows.forEach((row, index) => {
    const mapped = mapRow(row)
    const blId = asString(mapped.bl_id).toUpperCase()
    const containerNumber = asString(mapped.container_number).toUpperCase()
    const imoValue = asNullableText(mapped.is_imo)
    const imo = parseImoValue(mapped.is_imo)
    const oog = parseBooleanFlag(mapped.is_oog)

    if (!blId) {
      rowErrors.push({ row: index + 2, message: 'Linha sem BL.', raw: row })
      return
    }

    if (!containerNumber) {
      rowErrors.push({ row: index + 2, message: 'Linha sem Container.', raw: row })
      return
    }

    if (imo === 'invalid') {
      rowErrors.push({
        row: index + 2,
        message: 'Valor invalido em IMO. Informe a classe/numero IMO ou deixe em branco.',
        raw: row,
      })
      return
    }

    if (oog === null) {
      rowErrors.push({ row: index + 2, message: 'Valor invalido em OOG. Use apenas Sim ou Nao.', raw: row })
      return
    }

    parsedRows.push({
      bl_id: blId,
      container_number: containerNumber,
      is_imo: imo.is_imo,
      imo_class: imo.imo_class,
      un_number: imo.un_number,
      imo_value: imoValue,
      is_oog: oog,
    })
  })

  return {
    rows: Array.from(new Map(parsedRows.map((row) => [makeContainerKey(row.bl_id, row.container_number), row])).values()),
    rowErrors,
  }
}

function validateRequiredHeaders(rawHeaders: string[]) {
  const normalizedHeaders = rawHeaders.map((header) => normalizeText(header))
  const missing = Object.entries(requiredHeaders)
    .filter(([, label]) => !normalizedHeaders.includes(normalizeText(label)))
    .map(([, label]) => label)

  if (missing.length) {
    throw new Error(`Planilha invalida. Colunas obrigatorias: ${missing.join(', ')}.`)
  }
}

function mapRow(row: Record<string, unknown>) {
  const mapped: Partial<Record<DestinationField, unknown>> = {}

  Object.entries(row).forEach(([header, value]) => {
    const normalizedHeader = normalizeText(header)
    const destination = Object.entries(headerMap).find(([, candidates]) =>
      candidates.some((candidate) => normalizedHeader === normalizeText(candidate)),
    )?.[0] as DestinationField | undefined

    if (destination && mapped[destination] === undefined) {
      mapped[destination] = value
    }
  })

  return mapped
}

function parseBooleanFlag(value: unknown) {
  const normalized = normalizeText(asString(value))
  if (normalized === 'sim') return true
  if (normalized === 'nao') return false
  return null
}

function parseImoValue(value: unknown):
  | { is_imo: boolean; imo_class: string | null; un_number: string | null }
  | 'invalid' {
  const text = asString(value)
  if (!text) {
    return { is_imo: false, imo_class: null, un_number: null }
  }

  const upper = text.toUpperCase()
  const imoClassMatch = upper.match(/(?:IMO(?: CLASS)?|CLASS|CLASSE)\s*[:.-]?\s*([0-9.]+)/i)
  const unNumberMatch = upper.match(/UN\s*[:.-]?\s*(\d{4})/i)
  const fallbackClassMatch = upper.match(/\b([1-9](?:\.[0-9])?)\b/)

  const imoClass = imoClassMatch?.[1] ?? fallbackClassMatch?.[1] ?? upper
  const unNumber = unNumberMatch?.[1] ?? null

  if (!imoClass) {
    return 'invalid'
  }

  return {
    is_imo: true,
    imo_class: imoClass,
    un_number: unNumber,
  }
}

function makeContainerKey(blId: string, containerNumber: string) {
  return `${asString(blId).toUpperCase()}::${asString(containerNumber).toUpperCase()}`
}

function asNullableText(value: unknown) {
  const text = asString(value)
  return text || null
}

function normalizeValue(value: string | null | undefined) {
  return asString(value).toUpperCase()
}

function asString(value: unknown) {
  return String(value ?? '').trim()
}
