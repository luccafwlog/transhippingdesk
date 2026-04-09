import { normalizeText, onlyDigits } from '../lib/utils'
import type { Customer } from '../types/database'
import { supabase } from './supabase'

const headerMap = {
  cnpj_cpf: ['cnpj', 'cpf', 'cnpj/cpf', 'documento', 'tax id', 'vat'],
  name: ['razao social', 'nome', 'cliente', 'importador'],
  trade_name: ['nome fantasia', 'trade name', 'fantasia'],
  email: ['email', 'e-mail', 'mail'],
  address: ['endereco', 'address'],
  city: ['cidade', 'city'],
  state: ['uf', 'estado', 'state'],
  zip: ['cep', 'zip', 'zip code', 'zipcode'],
  consignee_blob: ['consignee'],
} as const

type DestinationField = keyof typeof headerMap

export type CustomerBaseRow = {
  cnpj_cpf: string
  name: string
  trade_name: string | null
  email: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
}

export type ParsedCustomerBase = {
  rows: CustomerBaseRow[]
  rowErrors: { row: number; message: string; raw: unknown }[]
}

export async function parseCustomerBaseFile(file: File): Promise<ParsedCustomerBase> {
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  const objectRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' })
  return parseCustomerBaseRows(objectRows)
}

export async function importCustomerBaseRows(rows: CustomerBaseRow[]) {
  const uniqueRows = Array.from(new Map(rows.map((row) => [row.cnpj_cpf, row])).values())
  if (!uniqueRows.length) {
    return { imported: 0, updated: 0 }
  }

  const documents = uniqueRows.map((row) => row.cnpj_cpf)
  const existingByDocument = new Map<string, Customer>()

  const { data: existingCustomers, error: existingError } = await supabase
    .from('customers')
    .select('*')
    .in('cnpj_cpf', documents)

  if (existingError) throw existingError

  ;(existingCustomers ?? []).forEach((customer) => existingByDocument.set(customer.cnpj_cpf, customer as Customer))

  let imported = 0
  let updated = 0

  const payload = uniqueRows.map((row) => {
    const existing = existingByDocument.get(row.cnpj_cpf)
    if (existing) updated += 1
    else imported += 1

    return {
      cnpj_cpf: row.cnpj_cpf,
      name: row.name || existing?.name || 'Cliente sem nome',
      trade_name: chooseText(row.trade_name, existing?.trade_name),
      address: chooseText(row.address, existing?.address),
      city: chooseText(row.city, existing?.city),
      state: chooseState(row.state, existing?.state),
      zip: chooseText(row.zip, existing?.zip),
      notes: existing?.notes ?? null,
      pending_balance: existing?.pending_balance ?? 0,
    }
  })

  const { error: upsertError } = await supabase.from('customers').upsert(payload, { onConflict: 'cnpj_cpf' })
  if (upsertError) throw upsertError

  return { imported, updated }
}

function parseCustomerBaseRows(rows: Record<string, unknown>[]): ParsedCustomerBase {
  const parsedRows: CustomerBaseRow[] = []
  const rowErrors: ParsedCustomerBase['rowErrors'] = []

  rows.forEach((row, index) => {
    const mapped = mapRow(row)
    const blob = asString(mapped.consignee_blob)
    const fallback = parseConsigneeBlob(blob)
    const cnpjCpf = pickDocument(mapped, fallback)
    const name = pickName(mapped, fallback)

    if (!cnpjCpf) {
      rowErrors.push({ row: index + 2, message: 'Linha sem CNPJ/CPF valido.', raw: row })
      return
    }

    if (!name) {
      rowErrors.push({ row: index + 2, message: 'Linha sem nome do cliente.', raw: row })
      return
    }

    parsedRows.push({
      cnpj_cpf: cnpjCpf,
      name,
      trade_name: asNullableText(mapped.trade_name),
      email: firstEmail(asString(mapped.email)) || fallback.email || null,
      address: asNullableText(mapped.address) || fallback.address || null,
      city: asNullableText(mapped.city),
      state: normalizeState(asNullableText(mapped.state)),
      zip: normalizeZip(asNullableText(mapped.zip)),
    })
  })

  const dedupedRows = Array.from(new Set(parsedRows.map((row) => row.cnpj_cpf))).map((document) =>
    mergeBestRow(parsedRows.filter((candidate) => candidate.cnpj_cpf === document)),
  )

  return { rows: dedupedRows, rowErrors }
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

function pickDocument(
  mapped: Partial<Record<DestinationField, unknown>>,
  fallback: ReturnType<typeof parseConsigneeBlob>,
) {
  const mappedDocument = normalizeDocument(asString(mapped.cnpj_cpf))
  if (mappedDocument) return mappedDocument
  return fallback.cnpj_cpf
}

function pickName(
  mapped: Partial<Record<DestinationField, unknown>>,
  fallback: ReturnType<typeof parseConsigneeBlob>,
) {
  return asNullableText(mapped.name) || fallback.name || ''
}

function parseConsigneeBlob(value: string) {
  const parts = asString(value)
    .split(/\r?\n/g)
    .map((part) => asString(part))
    .filter(Boolean)

  const name = parts[0] || ''
  const cnpj_cpf = parts.map(normalizeDocument).find(Boolean) || ''
  const email = parts.map(firstEmail).find(Boolean) || ''
  const address = parts
    .filter((_, index) => index > 0)
    .filter((part) => !normalizeDocument(part))
    .filter((part) => !firstEmail(part))
    .filter((part) => !/^(TEL|PHONE|FAX|EMAIL|E-?MAIL|ATTN|ATTENTION)\b/i.test(part))
    .join(' ')

  return {
    name,
    cnpj_cpf,
    email,
    address: address || '',
  }
}

function normalizeDocument(value: string) {
  const digits = onlyDigits(value)
  if (digits.length === 14 || digits.length === 11) return digits
  return ''
}

function firstEmail(value: string) {
  const match = asString(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  return match ? match[0].toUpperCase() : ''
}

function chooseText(primary?: string | null, fallback?: string | null) {
  const left = asNullableText(primary)
  const right = asNullableText(fallback)
  if (!left) return right ?? null
  if (!right) return left
  return left.length >= right.length ? left : right
}

function chooseState(primary?: string | null, fallback?: string | null) {
  return normalizeState(primary) || normalizeState(fallback)
}

function normalizeState(value?: string | null) {
  const text = asNullableText(value)?.toUpperCase() ?? ''
  if (!text) return null
  return text.slice(0, 2)
}

function normalizeZip(value?: string | null) {
  const digits = onlyDigits(value)
  return digits ? digits : null
}

function asNullableText(value: unknown) {
  const text = asString(value)
  return text || null
}

function asString(value: unknown) {
  return String(value ?? '').trim()
}

function mergeBestRow(rows: CustomerBaseRow[]) {
  return rows.reduce<CustomerBaseRow>(
    (best, current) => ({
      cnpj_cpf: current.cnpj_cpf,
      name: chooseBestName(best.name, current.name),
      trade_name: chooseText(current.trade_name, best.trade_name),
      email: chooseText(current.email, best.email),
      address: chooseText(current.address, best.address),
      city: chooseText(current.city, best.city),
      state: chooseState(current.state, best.state),
      zip: chooseText(current.zip, best.zip),
    }),
    rows[0],
  )
}

function chooseBestName(current: string, candidate: string) {
  const currentText = asString(current)
  const candidateText = asString(candidate)
  if (!currentText) return candidateText
  if (!candidateText) return currentText
  return candidateText.length >= currentText.length ? candidateText : currentText
}
