import { asString, onlyDigits } from '../lib/utils'
import { canonicalizeValidCnpj } from '../lib/cnpj'
import { assertUploadFile } from '../lib/fileGuard'
import type { Customer } from '../types/database'
import { supabase } from './supabase'
import { matchHeaders, readSheet, type HeaderSpec } from './importCore'

const headerMap = {
  cnpj_cpf: ['cnpj', 'cnpj/cpf'],
  name: ['razao social'],
  trade_name: ['nome fantasia', 'trade name', 'fantasia'],
  email: ['email', 'e-mail', 'mail'],
  address: ['endereco', 'address'],
  city: ['cidade', 'city'],
  state: ['uf', 'estado', 'state'],
  zip: ['cep', 'zip', 'zip code', 'zipcode'],
} as const

const requiredHeaders = {
  cnpj_cpf: 'CNPJ',
  name: 'Razao Social',
} as const

type DestinationField = keyof typeof headerMap
const SPEC: HeaderSpec<DestinationField> = {
  aliases: headerMap,
  required: ['cnpj_cpf', 'name'],
}

export type CustomerBaseRow = {
  cnpj_cpf: string
  name: string
  trade_name: string | null
  emails: string[]
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
  assertUploadFile(file, ['xlsx', 'xls', 'csv'])
  const buffer = await file.arrayBuffer()
  const { headers, rows } = await readSheet(buffer)
  validateRequiredHeaders(headers)
  return parseCustomerBaseRows(rows)
}

export async function importCustomerBaseRows(rows: CustomerBaseRow[]) {
  const uniqueRows = Array.from(new Map(rows.map((row) => [row.cnpj_cpf, row])).values())
  if (!uniqueRows.length) {
    return { imported: 0, updated: 0, contactsCreated: 0, blsLinked: 0 }
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
      name: row.name,
      trade_name: chooseText(row.trade_name, existing?.trade_name),
      address: chooseText(row.address, existing?.address),
      city: chooseText(row.city, existing?.city),
      state: chooseState(row.state, existing?.state),
      zip: chooseText(row.zip, existing?.zip),
      notes: existing?.notes ?? null,
      pending_balance: existing?.pending_balance ?? 0,
    }
  })

  const { data: upsertedCustomers, error: upsertError } = await supabase
    .from('customers')
    .upsert(payload, { onConflict: 'cnpj_cpf' })
    .select('id, cnpj_cpf')

  if (upsertError) throw upsertError

  const customersByDocument = new Map<string, { id: number; cnpj_cpf: string }>()
  ;(upsertedCustomers ?? []).forEach((customer) => customersByDocument.set(customer.cnpj_cpf, customer))

  let contactsCreated = 0
  for (const row of uniqueRows) {
    const customer = customersByDocument.get(row.cnpj_cpf)
    if (!customer) continue

    for (const email of row.emails) {
      const { data: created, error: rpcError } = await supabase.rpc('ensure_customer_contact_email', {
        p_customer_id: customer.id,
        p_email: email,
        p_contact_name: row.name,
      })
      if (rpcError) throw rpcError
      if (created) {
        contactsCreated += 1
      }
    }
  }

  // Retroactive BL linking: find unlinked BLs whose manifest CNPJ matches an upserted customer
  let blsLinked = 0
  const linkResults = await Promise.all(
    (upsertedCustomers ?? []).map((customer) =>
      supabase
        .from('bls')
        .update({ customer_id: customer.id })
        .eq('manifest_customer_cnpj_cpf', customer.cnpj_cpf)
        .is('customer_id', null)
        .select('id'),
    ),
  )
  for (const result of linkResults) {
    if (result.error) throw result.error
    blsLinked += result.data?.length ?? 0
  }

  return { imported, updated, contactsCreated, blsLinked }
}

function validateRequiredHeaders(rawHeaders: string[]) {
  const { missing: missingFields } = matchHeaders(rawHeaders, SPEC)
  const missing = missingFields.map((field) => requiredHeaders[field as keyof typeof requiredHeaders])

  if (missing.length) {
    throw new Error(`Base invalida. Colunas obrigatorias: ${missing.join(', ')}.`)
  }
}

export function parseCustomerBaseRows(rows: Record<string, unknown>[]): ParsedCustomerBase {
  const parsedRows: CustomerBaseRow[] = []
  const rowErrors: ParsedCustomerBase['rowErrors'] = []

  rows.forEach((row, index) => {
    const mapped = mapRow(row)
    const cnpjCpf = normalizeDocument(asString(mapped.cnpj_cpf))
    const name = asString(mapped.name)

    if (!cnpjCpf) {
      rowErrors.push({ row: index + 2, message: 'Linha sem CNPJ válido.', raw: row })
      return
    }

    if (!name) {
      rowErrors.push({ row: index + 2, message: 'Linha sem Razao Social.', raw: row })
      return
    }

    const emails = extractEmails(asString(mapped.email))
    if (!emails.length) {
      rowErrors.push({ row: index + 2, message: 'Linha sem e-mail válido.', raw: row })
      return
    }

    parsedRows.push({
      cnpj_cpf: cnpjCpf,
      name,
      trade_name: asNullableText(mapped.trade_name),
      emails,
      address: asNullableText(mapped.address),
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
  const { columnByField } = matchHeaders(Object.keys(row), SPEC)
  for (const [field, column] of Object.entries(columnByField) as [DestinationField, string][]) mapped[field] = row[column]
  return mapped
}

function normalizeDocument(value: string) {
  return canonicalizeValidCnpj(value) ?? ''
}

function extractEmails(value: string) {
  const matches = asString(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []
  return Array.from(new Set(matches.map((email) => normalizeEmail(email)).filter((email): email is string => Boolean(email))))
}

function normalizeEmail(value?: string | null) {
  const text = asString(value).trim().toLowerCase()
  return text || ''
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

function mergeBestRow(rows: CustomerBaseRow[]) {
  return rows.reduce<CustomerBaseRow>(
    (best, current) => ({
      cnpj_cpf: current.cnpj_cpf,
      name: chooseBestName(best.name, current.name),
      trade_name: chooseText(current.trade_name, best.trade_name),
      emails: mergeEmails(current.emails, best.emails),
      address: chooseText(current.address, best.address),
      city: chooseText(current.city, best.city),
      state: chooseState(current.state, best.state),
      zip: chooseText(current.zip, best.zip),
    }),
    rows[0],
  )
}

function mergeEmails(current: string[], candidate: string[]) {
  return Array.from(new Set([...candidate, ...current].map((email) => normalizeEmail(email)).filter(Boolean)))
}

function chooseBestName(current: string, candidate: string) {
  const currentText = asString(current)
  const candidateText = asString(candidate)
  if (!currentText) return candidateText
  if (!candidateText) return currentText
  return candidateText.length >= currentText.length ? candidateText : currentText
}
