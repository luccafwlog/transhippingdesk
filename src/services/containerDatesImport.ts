import { assertUploadFile } from '../lib/fileGuard'
import { extractErrorText } from '../lib/errors'
import { asString } from '../lib/utils'
import { matchHeaders, readSheet, type HeaderSpec } from './importCore'
import { supabase } from './supabase'
import { selectAgreementForDischargeDate } from './demurrage/customerDemurrageAgreements'
import { calculateDemurrage, ensureDemurrageRatesLoaded } from './demurrage/demurrageRates'
import { createInvoiceForReturnedBL } from './demurrage/demurrageInvoices'

const headerMap = {
  bl_id: ['bl', 'b/l', 'bill of lading'],
  container_number: ['container', 'container number', 'numero do container'],
  discharge_date: ['discharge', 'descarga', 'data descarga', 'data de descarga'],
  return_date: ['return', 'devolucao', 'retorno', 'data devolucao', 'data de devolucao'],
} as const

type DestinationField = keyof typeof headerMap
const SPEC: HeaderSpec<DestinationField> = {
  aliases: headerMap,
  required: ['bl_id', 'container_number', 'discharge_date'],
}

export type ContainerDatesImportRow = {
  bl_id: string
  container_number: string
  discharge_date: string
  return_date: string | null
}

export type ParsedContainerDatesImport = {
  rows: ContainerDatesImportRow[]
  rowErrors: { row: number; message: string; raw: unknown }[]
}

export async function parseContainerDatesFile(file: File): Promise<ParsedContainerDatesImport> {
  assertUploadFile(file, ['xlsx', 'xls', 'csv'])
  const buffer = await file.arrayBuffer()
  const { headers, rows } = await readSheet(buffer, { dates: 'date' })
  const { missing } = matchHeaders(headers, SPEC)
  if (missing.length) throw new Error(`Colunas obrigatorias ausentes: ${missing.join(', ')}.`)
  return parseRows(rows)
}

export type ContainerDatesImportError = { bl_id: string; container_number: string; message: string }

export type ContainerDatesImportResult = {
  updated: number
  unchanged: number
  missing: number
  errors: ContainerDatesImportError[]
}

export async function importContainerDates(rows: ContainerDatesImportRow[]): Promise<ContainerDatesImportResult> {
  if (!rows.length) return { updated: 0, unchanged: 0, missing: 0, errors: [] }

  const blIds = Array.from(new Set(rows.map((r) => r.bl_id)))

  const { data: containers, error: fetchError } = await supabase
    .from('bl_containers')
    .select('id, bl_id, container_number, container_type, discharge_date, return_date, demurrage_status')
    .in('bl_id', blIds)

  if (fetchError) throw fetchError

  const { data: bls, error: blsError } = await supabase
    .from('bls')
    .select('id, customer_id, free_time_override, demurrage_rate_override_p1_usd, demurrage_rate_override_p2_usd')
    .in('id', blIds)

  if (blsError) throw blsError

  const blOverrides = new Map(bls?.map((b) => [b.id, b]) ?? [])
  const customerIds = [...new Set((bls ?? []).map((b) => b.customer_id).filter((id): id is number => typeof id === 'number'))]
  // Todos os acordos ativos de cada cliente, e nao um por cliente: guardar
  // apenas o primeiro que a consulta devolvesse podia guardar um acordo vencido
  // (a consulta nao ordenava), e a validacao por data logo abaixo o descartaria,
  // fazendo o import cobrar pela tabela padrao apesar de existir acordo vigente.
  // A escolha correta depende da data de descarga de CADA container, entao ela
  // acontece na hora de calcular, nao aqui. Ordenado por vigencia decrescente,
  // como `findActiveAgreementForCustomer` ja fazia, para que o mais recente
  // venca quando dois periodos se sobrepoem.
  const customerAgreements = new Map<number, import('../types/customerDemurrageAgreements').CustomerDemurrageAgreement[]>()

  if (customerIds.length > 0) {
    const { data: agreements } = await supabase
      .from('customer_demurrage_agreements')
      .select('*')
      .in('customer_id', customerIds)
      .eq('active', true)
      .order('valid_from', { ascending: false })
      .order('id', { ascending: false })
    for (const a of (agreements ?? []) as unknown as import('../types/customerDemurrageAgreements').CustomerDemurrageAgreement[]) {
      const doCliente = customerAgreements.get(a.customer_id)
      if (doCliente) doCliente.push(a)
      else customerAgreements.set(a.customer_id, [a])
    }
  }

  type ContainerRow = { id: number; bl_id: string | null; container_number: string; container_type: string | null; discharge_date: string | null; return_date: string | null; demurrage_status: string | null }
  const containersByKey = new Map<string, ContainerRow>()
  for (const c of (containers as unknown as ContainerRow[]) ?? []) {
    containersByKey.set(makeKey(c.bl_id ?? '', c.container_number), c)
  }

  let updated = 0
  let unchanged = 0
  let missing = 0
  const errors: ContainerDatesImportError[] = []

  const uniqueRows = Array.from(new Map(rows.map((r) => [makeKey(r.bl_id, r.container_number), r])).values())

  // Track BL IDs where a container was newly set to 'returned'
  const blsToCheckForInvoice = new Set<string>()
  let demurrageRatesLoaded = false

  for (const row of uniqueRows) {
    const container = containersByKey.get(makeKey(row.bl_id, row.container_number))
    if (!container) { missing += 1; continue }

    const sameDischarge = container.discharge_date === row.discharge_date
    const sameReturn = container.return_date === (row.return_date ?? null)
    if (sameDischarge && sameReturn) {
      unchanged += 1
      // Uma execucao anterior interrompida no meio ja gravou a devolucao mas
      // abortou antes de faturar. No reimport do mesmo arquivo a linha volta
      // como inalterada; sem reenfileirar o B/L aqui a fatura de Demurrage
      // nunca nasceria. `createInvoiceForReturnedBL` e idempotente.
      if (container.demurrage_status === 'returned') blsToCheckForInvoice.add(row.bl_id)
      continue
    }

    const bl = blOverrides.get(row.bl_id)
    const doCliente = bl?.customer_id ? (customerAgreements.get(bl.customer_id) ?? []) : []
    const validAgreement = selectAgreementForDischargeDate(doCliente, row.discharge_date)

    if (!row.return_date && !demurrageRatesLoaded) {
      await ensureDemurrageRatesLoaded()
      demurrageRatesLoaded = true
    }
    const newStatus = resolveStatus(
      row.discharge_date,
      row.return_date,
      container.container_type,
      bl?.free_time_override ?? null,
      bl?.demurrage_rate_override_p1_usd ?? null,
      bl?.demurrage_rate_override_p2_usd ?? null,
      validAgreement,
    )

    const { error: updateError } = await supabase
      .from('bl_containers')
      .update({ discharge_date: row.discharge_date, return_date: row.return_date ?? null, demurrage_status: newStatus as 'within_free_time' | 'overdue' | 'returned' })
      .eq('id', container.id)

    if (updateError) {
      // Cada linha e uma transacao propria: abortar no meio deixaria "meia
      // carga" gravada e pularia o faturamento das linhas ja aplicadas.
      // Acumular o erro mantem o lote avancando e o relatorio honesto.
      errors.push({ bl_id: row.bl_id, container_number: row.container_number, message: extractErrorText(updateError) })
      continue
    }
    updated += 1

    if (newStatus === 'returned') blsToCheckForInvoice.add(row.bl_id)
  }

  // For each BL that had a container newly returned, check if ALL containers are now returned
  // and auto-generate a demurrage invoice if any demurrage is owed.
  for (const blId of blsToCheckForInvoice) {
    const blContainers = (containers as unknown as ContainerRow[]).filter((c) => c.bl_id === blId)
    const updatesForBl = new Map(uniqueRows.filter((r) => r.bl_id === blId).map((r) => [makeKey(r.bl_id, r.container_number), r]))

    const allReturned = blContainers.every((c) => {
      const update = updatesForBl.get(makeKey(c.bl_id ?? '', c.container_number))
      return update ? !!update.return_date : c.demurrage_status === 'returned'
    })

    if (allReturned) {
      // Nasce 'issued' com a foto inicial (ADR 0014). Retorna null se o B/L já
      // tem fatura ativa (não sobrescreve) ou se não há demurrage devido.
      try {
        await createInvoiceForReturnedBL(blId)
      } catch (error) {
        // Um B/L que falha ao faturar nao pode impedir o faturamento dos demais.
        errors.push({ bl_id: blId, container_number: '', message: extractErrorText(error) })
      }
    }
  }

  return { updated, unchanged, missing, errors }
}

function resolveStatus(
  dischargeDate: string,
  returnDate: string | null,
  containerType: string | null,
  freeTimeOverride: number | null,
  ov1: number | null,
  ov2: number | null,
  customerAgreement?: { free_days?: number | null; p1_usd?: number | null; p2_usd?: number | null } | null,
): string {
  if (returnDate) return 'returned'
  const today = new Date().toISOString().slice(0, 10)
  const result = calculateDemurrage(containerType, dischargeDate, today, freeTimeOverride, ov1, ov2, customerAgreement)
  return result.total_usd > 0 ? 'overdue' : 'within_free_time'
}

function parseRows(objectRows: Record<string, unknown>[]): ParsedContainerDatesImport {
  const rows: ContainerDatesImportRow[] = []
  const rowErrors: ParsedContainerDatesImport['rowErrors'] = []

  objectRows.forEach((row, index) => {
    const mapped = mapRow(row)
    const blId = asString(mapped.bl_id).toUpperCase()
    const containerNumber = asString(mapped.container_number).toUpperCase()
    const rawDischarge = mapped.discharge_date
    const rawReturn = mapped.return_date

    if (!blId) { rowErrors.push({ row: index + 2, message: 'Linha sem BL.', raw: row }); return }
    if (!containerNumber) { rowErrors.push({ row: index + 2, message: 'Linha sem Container.', raw: row }); return }

    const discharge = parseDate(rawDischarge)
    if (!discharge) { rowErrors.push({ row: index + 2, message: 'Data de descarga invalida ou ausente.', raw: row }); return }

    const returnDate = rawReturn != null && asString(rawReturn) ? parseDate(rawReturn) : null
    if (rawReturn != null && asString(rawReturn) && !returnDate) {
      rowErrors.push({ row: index + 2, message: 'Data de devolucao invalida.', raw: row }); return
    }
    if (returnDate && returnDate < discharge) {
      rowErrors.push({ row: index + 2, message: 'Data de devolucao anterior a descarga.', raw: row }); return
    }

    rows.push({ bl_id: blId, container_number: containerNumber, discharge_date: discharge, return_date: returnDate })
  })

  return {
    rows: Array.from(new Map(rows.map((r) => [makeKey(r.bl_id, r.container_number), r])).values()),
    rowErrors,
  }
}

function parseDate(value: unknown): string | null {
  if (!value) return null
  // XLSX cellDates:true returns Date objects
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  const s = String(value).trim()
  if (!s) return null
  // ISO format YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  // Brazilian format DD/MM/YYYY or DD-MM-YYYY
  const parts = s.split(/[-/]/)
  if (parts.length === 3 && parts[0].length <= 2) {
    const [d, m, y] = parts
    const iso = `${y.padStart(4, '20')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  }
  return null
}

function mapRow(row: Record<string, unknown>) {
  const mapped: Partial<Record<DestinationField, unknown>> = {}
  const { columnByField } = matchHeaders(Object.keys(row), SPEC)
  for (const [field, column] of Object.entries(columnByField) as [DestinationField, string][]) {
    mapped[field] = row[column]
  }
  return mapped
}

function makeKey(blId: string, containerNumber: string) {
  return `${String(blId).toUpperCase()}::${String(containerNumber).toUpperCase()}`
}
