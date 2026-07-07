import { asString, normalizeText, onlyDigits } from '../lib/utils'
import { assertUploadFile } from '../lib/fileGuard'
import type { Customer, CustomerContact } from '../types/database'
import { supabase } from './supabase'

const headerMap = {
  cnpj_cpf: ['cnpj/cpf', 'cnpj', 'cpf'],
  name: ['razao social'],
  trade_name: ['nome fantasia', 'trade name', 'fantasia'],
  email: ['email', 'e-mail', 'mail'],
  address: ['endereco', 'address'],
  city: ['cidade', 'city'],
  state: ['uf', 'estado', 'state'],
  zip: ['cep', 'zip', 'zip code', 'zipcode'],
} as const

const requiredHeaders = {
  cnpj_cpf: 'CNPJ/CPF',
  name: 'Razao Social',
} as const

type DestinationField = keyof typeof headerMap

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
  const XLSX = await import('@e965/xlsx')
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
  return parseCustomerBaseRows(objectRows)
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
  const customerIds = (upsertedCustomers ?? []).map((customer) => customer.id)

  if (customerIds.length) {
    const { data: existingContacts, error: contactsError } = await supabase
      .from('customer_contacts')
      .select('customer_id, email, is_primary')
      .in('customer_id', customerIds)

    if (contactsError) throw contactsError

    const emailsByCustomerId = new Map<number, Set<string>>()
    const hasPrimaryByCustomerId = new Map<number, boolean>()

    ;(existingContacts ?? []).forEach((contact) => {
      if (!contact.customer_id) return

      const currentEmails = emailsByCustomerId.get(contact.customer_id) ?? new Set<string>()
      const normalizedEmail = normalizeEmail(contact.email)
      if (normalizedEmail) currentEmails.add(normalizedEmail)
      emailsByCustomerId.set(contact.customer_id, currentEmails)

      if (contact.is_primary) {
        hasPrimaryByCustomerId.set(contact.customer_id, true)
      }
    })

    const contactsToInsert = uniqueRows.flatMap((row) => {
      const customer = customersByDocument.get(row.cnpj_cpf)
      if (!customer) return []

      const existingEmails = emailsByCustomerId.get(customer.id) ?? new Set<string>()
      let canAssignPrimary = !hasPrimaryByCustomerId.get(customer.id)

      return row.emails
        .map((email) => normalizeEmail(email))
        .filter((email): email is string => Boolean(email))
        .filter((email) => !existingEmails.has(email))
        .map((email) => {
          existingEmails.add(email)
          const nextContact = {
            customer_id: customer.id,
            name: row.name,
            email,
            phone: null,
            purpose: 'geral' as NonNullable<CustomerContact['purpose']>,
            is_primary: canAssignPrimary,
          }
          canAssignPrimary = false
          return nextContact
        })
    })

    if (contactsToInsert.length) {
      const { error: insertContactsError } = await supabase.from('customer_contacts').insert(contactsToInsert)
      if (insertContactsError) throw insertContactsError
      contactsCreated = contactsToInsert.length
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
  const normalizedHeaders = rawHeaders.map((header) => normalizeText(header))
  const missing = Object.entries(requiredHeaders)
    .filter(([, label]) => !normalizedHeaders.includes(normalizeText(label)))
    .map(([, label]) => label)

  if (missing.length) {
    throw new Error(`Base invalida. Colunas obrigatorias: ${missing.join(', ')}.`)
  }
}

function parseCustomerBaseRows(rows: Record<string, unknown>[]): ParsedCustomerBase {
  const parsedRows: CustomerBaseRow[] = []
  const rowErrors: ParsedCustomerBase['rowErrors'] = []

  rows.forEach((row, index) => {
    const mapped = mapRow(row)
    const cnpjCpf = normalizeDocument(asString(mapped.cnpj_cpf))
    const name = asString(mapped.name)

    if (!cnpjCpf) {
      rowErrors.push({ row: index + 2, message: 'Linha sem CNPJ/CPF valido.', raw: row })
      return
    }

    if (!name) {
      rowErrors.push({ row: index + 2, message: 'Linha sem Razao Social.', raw: row })
      return
    }

    parsedRows.push({
      cnpj_cpf: cnpjCpf,
      name,
      trade_name: asNullableText(mapped.trade_name),
      emails: extractEmails(asString(mapped.email)),
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

function normalizeDocument(value: string) {
  const digits = onlyDigits(value)
  if (digits.length === 14 || digits.length === 11) return digits
  return ''
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
