import { assertUploadFile } from '../lib/fileGuard'
import { asString, chunkArray, normalizeText } from '../lib/utils'
import { supabase } from './supabase'
import { calculateBlLocalCharges } from './charges/chargeOperationsService'

// Aliases por campo. Cobrem tres formatos de origem:
// 1) Planilha modelo do sistema (cabecalhos em portugues: CHASSI, MARCA, ...).
// 2) "Daily Report" do armador COSCO (cabecalhos em ingles: VIN NO., GW(kg), ...),
//    cujos dados de veiculo ficam na segunda aba do arquivo.
// 3) Lista de VINs dos terminais chineses da COSCO (TAICANG/NANSHA), com
//    cabecalhos em chines: 品牌 (marca), 型号 (modelo), 提单号 (BL), 箱号 (container)...
const headerMap = {
  chassis: ['chassi', 'chassis', 'vin', 'vin no', 'vin no.', 'vin number'],
  brand: ['marca', 'brand', '品牌'],
  model: ['modelo', 'model', '型号'],
  weight_kg: ['peso', 'weight', 'gw', 'gw(kg)', 'gross weight', '毛重'],
  cbm: ['cubagem', 'cbm', 'm3', 'volume', '体积'],
  container_number: ['container', 'container number', 'numero do container', 'cntr no', 'cntr no.', 'cntr number', '箱号'],
  container_type: ['tipo_container', 'tipo do container', 'container type', 'tipo', 'cntr type', '箱型'],
  seal_number: ['lacre', 'seal', 'seal number', '封号'],
  bl_id: ['bl', 'b/l', 'bill of lading', 'bl number', 'bl no', 'bl no.', '提单号'],
} as const

const requiredHeaders = {
  chassis: 'CHASSI',
  brand: 'MARCA',
  model: 'MODELO',
  weight_kg: 'PESO',
  cbm: 'CUBAGEM',
  container_number: 'CONTAINER',
  container_type: 'TIPO_CONTAINER',
  seal_number: 'LACRE',
  bl_id: 'BL',
} as const

// Marcas em chines → nome latino usado no sistema. Os arquivos dos terminais
// da COSCO (TAICANG/NANSHA) trazem a marca em chines (ex: 比亚迪 = BYD), o que
// duplica a marca nos relatorios. Quando nao houver correspondencia, mantemos
// o valor original.
const brandTranslations: Record<string, string> = {
  比亚迪: 'BYD',
  奇瑞: 'CHERY',
  吉利: 'GEELY',
  长城: 'GREAT WALL',
  长安: 'CHANGAN',
  广汽: 'GAC',
  广汽埃安: 'AION',
  埃安: 'AION',
  上汽: 'SAIC',
  上汽大通: 'MAXUS',
  名爵: 'MG',
  五菱: 'WULING',
  江淮: 'JAC',
  蔚来: 'NIO',
  小鹏: 'XPENG',
  理想: 'LI AUTO',
  零跑: 'LEAPMOTOR',
  哪吒: 'NETA',
  红旗: 'HONGQI',
}

function translateBrand(brand: string): string {
  return brandTranslations[brand.trim()] ?? brand
}

type DestinationField = keyof typeof headerMap

export type VehicleImportRow = {
  rowNumber: number
  chassis: string
  brand: string
  model: string
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
  assertUploadFile(file, ['xlsx', 'xls', 'csv'])
  const buffer = await file.arrayBuffer()
  return parseVehicleImportBuffer(buffer)
}

export async function parseVehicleImportBuffer(buffer: ArrayBuffer): Promise<ParsedVehicleImport> {
  const XLSX = await import('@e965/xlsx')
  const workbook = XLSX.read(buffer, { type: 'array', cellText: true })

  if (!workbook.SheetNames.length) {
    throw new Error('Arquivo sem abas validas.')
  }

  // O modelo do armador (COSCO Daily Report) mantem os veiculos na segunda aba;
  // a primeira e um resumo. Selecionamos a primeira aba cujo cabecalho atende
  // todas as colunas obrigatorias, mantendo compatibilidade com a planilha modelo.
  let chosenSheet: (typeof workbook.Sheets)[string] | undefined
  let lastMissing: string[] = Object.values(requiredHeaders)

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: false,
    })

    const rawHeaders = (matrix[0] ?? []).map((cell) => String(cell ?? '').trim())
    const missing = missingRequiredHeaders(rawHeaders)
    if (!missing.length) {
      chosenSheet = sheet
      break
    }
    lastMissing = missing
  }

  if (!chosenSheet) {
    throw new Error(`Planilha invalida. Colunas obrigatorias: ${lastMissing.join(', ')}.`)
  }

  const objectRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(chosenSheet, { defval: '', raw: false })
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

  const existingVehicles = await fetchInChunks(uniqueChassis, 250, async (chunk) => {
    const { data, error } = await supabase
      .from('vehicles')
      .select('id, chassis')
      .eq('voyage_id', voyageId)
      .in('chassis', chunk)
    if (error) throw error
    return (data ?? []) as Array<{ id: number; chassis: string }>
  })

  const existingVehicleChassis = new Set((existingVehicles ?? []).map((vehicle) => normalizeKey(vehicle.chassis)))

  const matchedBls = await fetchInChunks(uniqueBls, 250, async (chunk) => {
    const { data, error } = await supabase
      .from('bls')
      .select('id, voyage_id')
      .eq('voyage_id', voyageId)
      .in('id', chunk)
    if (error) throw error
    return (data ?? []) as Array<{ id: string; voyage_id: number | null }>
  })

  const blMap = new Map((matchedBls ?? []).map((bl) => [normalizeKey(bl.id), bl]))

  type ContainerCandidate = {
    id: number
    bl_id: string | null
    container_number: string
    type: string | null
    seal_number: string | null
    bl?: { voyage_id: number | null } | null
  }

  const queryPageSize = 1000
  const containersByBlAndNumber = new Map<string, ContainerCandidate[]>()
  const containerNumbersInVoyage = new Set<string>()

  for (const blChunk of chunkArray(uniqueBls, 200)) {
    let offset = 0
    while (true) {
      const { data, error } = await supabase
        .from('bl_containers')
        .select('id, bl_id, container_number, type, seal_number, bl:bls!inner(voyage_id)')
        .in('bl_id', blChunk)
        .eq('bl.voyage_id', voyageId)
        .order('id', { ascending: true })
        .range(offset, offset + queryPageSize - 1)

      if (error) throw error

      const batch = (data ?? []) as unknown as ContainerCandidate[]
      if (!batch.length) break

      for (const container of batch) {
        if (!container.bl_id || !container.container_number) continue
        const key = `${normalizeKey(container.bl_id)}|${normalizeKey(container.container_number)}`
        const current = containersByBlAndNumber.get(key) ?? []
        current.push(container)
        containersByBlAndNumber.set(key, current)
        containerNumbersInVoyage.add(normalizeKey(container.container_number))
      }

      if (batch.length < queryPageSize) break
      offset += queryPageSize
    }
  }

  const rowsToInsert: Array<{
    voyage_id: number
    container_id: number
    bl_id: string
    chassis: string
    brand: string
    model: string
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

    const containerKey = `${normalizeKey(row.bl_id)}|${row.container_number}`
    const containerCandidates = containersByBlAndNumber.get(containerKey) ?? []
    if (!containerCandidates.length) {
      if (!containerNumbersInVoyage.has(row.container_number)) {
        errors.push({ row: row.rowNumber, message: 'Container nao encontrado no sistema.' })
      } else {
        errors.push({ row: row.rowNumber, message: 'BL nao pertence ao container informado.' })
      }
      continue
    }

    const typeMismatch = containerCandidates.every(
      (container) => Boolean(container.type) && normalizeKey(container.type) !== normalizeKey(row.container_type),
    )
    if (typeMismatch) {
      errors.push({ row: row.rowNumber, message: 'Tipo do container nao confere com o sistema.' })
      continue
    }

    const sealMismatch = containerCandidates.every(
      (container) => Boolean(container.seal_number) && normalizeKey(container.seal_number) !== normalizeKey(row.seal_number),
    )
    if (sealMismatch) {
      errors.push({ row: row.rowNumber, message: 'Lacre nao confere com o sistema.' })
      continue
    }

    // F-03: Exigir match exato (tipo + lacre) quando ambos estao preenchidos
    // no banco. Se nao houver match exato, nao cair em fallback silencioso
    // para containerCandidates[0]: recusa com erro explicito.
    const exactMatches = containerCandidates.filter(
      (container) =>
        (!container.type || normalizeKey(container.type) === normalizeKey(row.container_type)) &&
        (!container.seal_number || normalizeKey(container.seal_number) === normalizeKey(row.seal_number)),
    )

    if (exactMatches.length !== 1) {
      errors.push({
        row: row.rowNumber,
        message:
          exactMatches.length === 0
            ? 'Nao foi possivel identificar com seguranca qual container desta BL corresponde ao veiculo (tipo ou lacre divergem).'
            : 'Mais de um container desta BL atende ao tipo/lacre informado; revise a planilha para evitar ambiguidade.',
      })
      continue
    }

    const [exactContainer] = exactMatches

    rowsToInsert.push({
      voyage_id: voyageId,
      container_id: exactContainer.id,
      bl_id: matchedBl.id,
      chassis: row.chassis,
      brand: row.brand,
      model: row.model,
      weight_kg: row.weight_kg,
      cbm: row.cbm,
    })
    existingVehicleChassis.add(row.chassis)
  }

  if (rowsToInsert.length) {
    const { error: insertError } = await supabase.rpc('import_vehicle_rows_transactional', {
      p_rows: rowsToInsert,
    })
    if (insertError) throw insertError

    // Veiculos sao cadastrados depois dos containers/BLs: no momento do manifesto
    // as taxas locais ja foram calculadas e a fatura individual pode ja ter sido
    // emitida (gatilho emit_invoice_on_bl_ready). Ao vincular veiculos, o BL passa
    // a ser isento, entao para cada BL impactado: (1) cancelamos qualquer fatura
    // ativa do BL e (2) recalculamos as taxas via RPC, que remove as linhas "auto"
    // e marca o BL como isento. Apenas setar charge_status='exempt' (como era feito
    // antes) deixava as taxas calculadas e a fatura emitida ativas.
    const impactedBlIds = Array.from(new Set(rowsToInsert.map((row) => row.bl_id)))
    const blRowNumber = new Map<string, number>()
    for (const row of validRows) {
      if (!blRowNumber.has(row.bl_id)) blRowNumber.set(row.bl_id, row.rowNumber)
    }

    const activeInvoicesByBl = await loadActiveInvoicesByBl(impactedBlIds)

    for (const blId of impactedBlIds) {
      try {
        for (const invoiceId of activeInvoicesByBl.get(blId) ?? []) {
          const { error: cancelError } = await supabase.rpc('cancel_invoice', {
            p_invoice_id: invoiceId,
            p_reason: 'Carga de veiculos: BL isento de taxas locais.',
          })
          if (cancelError) throw cancelError
        }
        await calculateBlLocalCharges(blId, { recalculate: true })
      } catch (err) {
        errors.push({
          row: blRowNumber.get(blId) ?? 0,
          message: `BL ${blId}: veiculos cadastrados, mas falha ao isentar/cancelar fatura (${err instanceof Error ? err.message : 'erro desconhecido'}). Ajuste manual no Faturamento.`,
        })
      }
    }
  }

  return {
    processed: rows.length,
    successCount: rowsToInsert.length,
    errorCount: errors.length,
    errors: errors.sort((left, right) => left.row - right.row),
  }
}

// Faturas ativas (nao canceladas) vinculadas a cada BL impactado, para serem
// canceladas antes de marcar o BL como isento de taxas.
const ACTIVE_INVOICE_STATUSES = new Set(['draft', 'issued', 'partially_paid', 'overdue', 'paid'])

async function loadActiveInvoicesByBl(blIds: string[]): Promise<Map<string, Set<number>>> {
  const byBl = new Map<string, Set<number>>()
  if (!blIds.length) return byBl

  const { data: links, error: linkError } = await supabase
    .from('invoice_bls')
    .select('bl_id, invoice_id')
    .in('bl_id', blIds)
  if (linkError) throw linkError

  const linkRows = (links ?? []) as Array<{ bl_id: string; invoice_id: number }>
  const invoiceIds = Array.from(new Set(linkRows.map((link) => link.invoice_id)))
  if (!invoiceIds.length) return byBl

  const { data: invoices, error: invoiceError } = await supabase
    .from('invoices')
    .select('id, status')
    .in('id', invoiceIds)
  if (invoiceError) throw invoiceError

  const activeIds = new Set(
    ((invoices ?? []) as Array<{ id: number; status: string | null }>)
      .filter((invoice) => ACTIVE_INVOICE_STATUSES.has(invoice.status ?? 'issued'))
      .map((invoice) => invoice.id),
  )

  for (const link of linkRows) {
    if (!activeIds.has(link.invoice_id)) continue
    const set = byBl.get(link.bl_id) ?? new Set<number>()
    set.add(link.invoice_id)
    byBl.set(link.bl_id, set)
  }

  return byBl
}

function parseVehicleImportRows(rows: Record<string, unknown>[]): ParsedVehicleImport {
  const parsedRows: VehicleImportRow[] = []
  const rowErrors: ParsedVehicleImport['rowErrors'] = []

  rows.forEach((row, index) => {
    const mapped = mapRow(row)
    const rowNumber = index + 2

    const chassis = normalizeKey(mapped.chassis)
    const brand = translateBrand(asString(mapped.brand))
    const model = asString(mapped.model)
    const weight = parseSpreadsheetNumber(mapped.weight_kg)
    const cbm = parseSpreadsheetNumber(mapped.cbm)
    const containerNumber = normalizeKey(mapped.container_number)
    const containerType = normalizeKey(mapped.container_type)
    const sealNumber = normalizeKey(mapped.seal_number)
    const blId = normalizeKey(mapped.bl_id)

    if (
      !chassis ||
      !brand ||
      !model ||
      weight === null ||
      cbm === null ||
      !containerNumber ||
      !containerType ||
      !sealNumber ||
      !blId
    ) {
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
      model,
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

// Retorna os rotulos das colunas obrigatorias ausentes considerando os aliases
// de cada campo (planilha modelo e modelo do armador).
function missingRequiredHeaders(rawHeaders: string[]) {
  const normalizedHeaders = rawHeaders.map((header) => normalizeText(header))
  return (Object.keys(headerMap) as DestinationField[])
    .filter((field) => !headerMap[field].some((alias) => normalizedHeaders.includes(normalizeText(alias))))
    .map((field) => requiredHeaders[field])
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

function normalizeKey(value: unknown) {
  return asString(value).toUpperCase()
}

async function fetchInChunks<TInput extends string, TResult>(
  values: TInput[],
  chunkSize: number,
  fetcher: (chunk: TInput[]) => Promise<TResult[]>,
) {
  const collected: TResult[] = []
  for (const chunk of chunkArray(values, chunkSize)) {
    const batch = await fetcher(chunk)
    collected.push(...batch)
  }
  return collected
}
