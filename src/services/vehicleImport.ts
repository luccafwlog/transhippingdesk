import { normalizeText } from '../lib/utils'
import { supabase } from './supabase'

const headerMap = {
  chassis: ['chassi', 'chassis'],
  brand: ['marca', 'brand'],
  weight_kg: ['peso', 'weight'],
  cbm: ['cubagem', 'cbm', 'm3'],
  container_number: ['container', 'container number', 'numero do container'],
  container_type: ['tipo_container', 'tipo do container', 'container type', 'tipo'],
  seal_number: ['lacre', 'seal', 'seal number'],
  bl_id: ['bl', 'b/l', 'bill of lading'],
} as const

const requiredHeaders = {
  chassis: 'CHASSI',
  brand: 'MARCA',
  weight_kg: 'PESO',
  cbm: 'CUBAGEM',
  container_number: 'CONTAINER',
  container_type: 'TIPO_CONTAINER',
  seal_number: 'LACRE',
  bl_id: 'BL',
} as const

type DestinationField = keyof typeof headerMap

export type VehicleImportRow = {
  rowNumber: number
  chassis: string
  brand: string
  weight_kg: number
  cbm: number
  container_number: string
  container_type: string
  seal_number: string
  bl_id: string
}

export type ParsedVehicleImport = {
  rows: VehicleImportRow[]
  rowErrors: { row: number; message: string; raw: unknown }[]
}

export type VehicleImportResult = {
  processed: number
  successCount: number
  errorCount: number
  errors: { row: number; message: string }[]
}

export async function parseVehicleImportFile(file: File): Promise<ParsedVehicleImport> {
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
  return parseVehicleImportRows(objectRows)
}

export async function importVehicleRows({
  voyageId,
  rows,
}: {
  voyageId: number
  rows: VehicleImportRow[]
}): Promise<VehicleImportResult> {
  const errors: VehicleImportResult['errors'] = []
  const seenChassis = new Set<string>()

  for (const row of rows) {
    if (seenChassis.has(row.chassis)) {
      errors.push({ row: row.rowNumber, message: 'Chassi duplicado no arquivo para a viagem selecionada.' })
    } else {
      seenChassis.add(row.chassis)
    }
  }

  const validRows = rows.filter((row) => !errors.some((error) => error.row === row.rowNumber))
  if (!validRows.length) {
    return {
      processed: rows.length,
      successCount: 0,
      errorCount: errors.length,
      errors,
    }
  }

  const uniqueChassis = Array.from(new Set(validRows.map((row) => row.chassis)))
  const uniqueBls = Array.from(new Set(validRows.map((row) => row.bl_id)))
  const uniqueContainers = Array.from(new Set(validRows.map((row) => row.container_number)))

  const { data: existingVehicles, error: existingVehiclesError } = await supabase
    .from('vehicles')
    .select('id, chassis')
    .eq('voyage_id', voyageId)
    .in('chassis', uniqueChassis)

  if (existingVehiclesError) throw existingVehiclesError

  const existingVehicleChassis = new Set((existingVehicles ?? []).map((vehicle) => normalizeKey(vehicle.chassis)))

  const { data: matchedBls, error: blError } = await supabase
    .from('bls')
    .select('id, voyage_id')
    .eq('voyage_id', voyageId)
    .in('id', uniqueBls)

  if (blError) throw blError

  const blMap = new Map((matchedBls ?? []).map((bl) => [normalizeKey(bl.id), bl]))

  const { data: matchingContainers, error: containerError } = await supabase
    .from('bl_containers')
    .select('id, bl_id, container_number, type, seal_number, bl:bls(voyage_id)')
    .in('container_number', uniqueContainers)

  if (containerError) throw containerError

  const containersByNumber = new Map<string, Array<{
    id: number
    bl_id: string | null
    container_number: string
    type: string | null
    seal_number: string | null
    bl?: { voyage_id: number | null } | null
  }>>()

  for (const container of (matchingContainers ?? []) as Array<{
    id: number
    bl_id: string | null
    container_number: string
    type: string | null
    seal_number: string | null
    bl?: { voyage_id: number | null } | null
  }>) {
    const key = normalizeKey(container.container_number)
    const current = containersByNumber.get(key) ?? []
    current.push(container)
    containersByNumber.set(key, current)
  }

  const rowsToInsert: Array<{
    voyage_id: number
    container_id: number
    bl_id: string
    chassis: string
    brand: string
    weight_kg: number
    cbm: number
  }> = []

  for (const row of validRows) {
    if (existingVehicleChassis.has(row.chassis)) {
      errors.push({ row: row.rowNumber, message: 'Chassi ja cadastrado nesta viagem.' })
      continue
    }

    const matchedBl = blMap.get(normalizeKey(row.bl_id))
    if (!matchedBl) {
      errors.push({ row: row.rowNumber, message: 'BL nao encontrado na viagem selecionada.' })
      continue
    }

    const containerCandidates = containersByNumber.get(row.container_number) ?? []
    if (!containerCandidates.length) {
      errors.push({ row: row.rowNumber, message: 'Container nao encontrado no sistema.' })
      continue
    }

    const voyageCandidates = containerCandidates.filter((container) => container.bl?.voyage_id === voyageId)
    if (!voyageCandidates.length) {
      errors.push({ row: row.rowNumber, message: 'Container nao pertence a viagem selecionada.' })
      continue
    }

    const exactContainer = voyageCandidates.find((container) => normalizeKey(container.bl_id) === normalizeKey(row.bl_id))
    if (!exactContainer) {
      errors.push({ row: row.rowNumber, message: 'BL nao pertence ao container informado.' })
      continue
    }

    if (exactContainer.type && normalizeKey(exactContainer.type) !== normalizeKey(row.container_type)) {
      errors.push({ row: row.rowNumber, message: 'Tipo do container nao confere com o sistema.' })
      continue
    }

    if (exactContainer.seal_number && normalizeKey(exactContainer.seal_number) !== normalizeKey(row.seal_number)) {
      errors.push({ row: row.rowNumber, message: 'Lacre nao confere com o sistema.' })
      continue
    }

    rowsToInsert.push({
      voyage_id: voyageId,
      container_id: exactContainer.id,
      bl_id: matchedBl.id,
      chassis: row.chassis,
      brand: row.brand,
      weight_kg: row.weight_kg,
      cbm: row.cbm,
    })
    existingVehicleChassis.add(row.chassis)
  }

  if (rowsToInsert.length) {
    const { error: insertError } = await supabase.from('vehicles').insert(rowsToInsert)
    if (insertError) throw insertError
  }

  return {
    processed: rows.length,
    successCount: rowsToInsert.length,
    errorCount: errors.length,
    errors: errors.sort((left, right) => left.row - right.row),
  }
}

function parseVehicleImportRows(rows: Record<string, unknown>[]): ParsedVehicleImport {
  const parsedRows: VehicleImportRow[] = []
  const rowErrors: ParsedVehicleImport['rowErrors'] = []

  rows.forEach((row, index) => {
    const mapped = mapRow(row)
    const rowNumber = index + 2

    const chassis = normalizeKey(mapped.chassis)
    const brand = asString(mapped.brand)
    const weight = parseSpreadsheetNumber(mapped.weight_kg)
    const cbm = parseSpreadsheetNumber(mapped.cbm)
    const containerNumber = normalizeKey(mapped.container_number)
    const containerType = normalizeKey(mapped.container_type)
    const sealNumber = normalizeKey(mapped.seal_number)
    const blId = normalizeKey(mapped.bl_id)

    if (!chassis || !brand || weight === null || cbm === null || !containerNumber || !containerType || !sealNumber || !blId) {
      rowErrors.push({ row: rowNumber, message: 'Todos os campos obrigatorios devem ser preenchidos.', raw: row })
      return
    }

    if (weight <= 0 || cbm <= 0) {
      rowErrors.push({ row: rowNumber, message: 'Peso e cubagem devem ser numericos e maiores que zero.', raw: row })
      return
    }

    parsedRows.push({
      rowNumber,
      chassis,
      brand,
      weight_kg: weight,
      cbm,
      container_number: containerNumber,
      container_type: containerType,
      seal_number: sealNumber,
      bl_id: blId,
    })
  })

  return { rows: parsedRows, rowErrors }
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

function parseSpreadsheetNumber(value: unknown) {
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

function asString(value: unknown) {
  return String(value ?? '').trim()
}

function normalizeKey(value: unknown) {
  return asString(value).toUpperCase()
}
