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
    .select('id, bl_id, container_number, is_imo, is_oog')
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
      .filter((container) => Boolean(container.is_imo) !== row.is_imo || Boolean(container.is_oog) !== row.is_oog)
      .map((container) => container.id)

    if (!idsToUpdate.length) {
      unchanged += 1
      continue
    }

    const { error: updateError } = await supabase
      .from('bl_containers')
      .update({
        is_imo: row.is_imo,
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
    const imo = parseBooleanFlag(mapped.is_imo)
    const oog = parseBooleanFlag(mapped.is_oog)

    if (!blId) {
      rowErrors.push({ row: index + 2, message: 'Linha sem BL.', raw: row })
      return
    }

    if (!containerNumber) {
      rowErrors.push({ row: index + 2, message: 'Linha sem Container.', raw: row })
      return
    }

    if (imo === null) {
      rowErrors.push({ row: index + 2, message: 'Valor invalido em IMO. Use apenas Sim ou Nao.', raw: row })
      return
    }

    if (oog === null) {
      rowErrors.push({ row: index + 2, message: 'Valor invalido em OOG. Use apenas Sim ou Nao.', raw: row })
      return
    }

    parsedRows.push({
      bl_id: blId,
      container_number: containerNumber,
      is_imo: imo,
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

function makeContainerKey(blId: string, containerNumber: string) {
  return `${asString(blId).toUpperCase()}::${asString(containerNumber).toUpperCase()}`
}

function asString(value: unknown) {
  return String(value ?? '').trim()
}
