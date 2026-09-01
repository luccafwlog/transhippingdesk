import type { DemurrageInvoice } from '../types/database'
import { supabase } from './supabase'

export type DemurrageDunningAttempt = {
  attemptDiscriminator: number
  status: string
  createdAt: string
}

export type DemurrageDunningDisplay = {
  invoiceId: number
  attemptCount: number
  nextAttemptNumber: number
  nextDate: string | null
  statusLabel: string
  pauseReason: string | null
  lastAttemptAt: string | null
}

export type DemurrageDunningStatusRow = {
  invoiceId: number
  attemptCount: number
  lastAttemptAt: string | null
  hasValidContact: boolean
  intervalDays: number
}

type DunningCommunicationRow = {
  anchor_invoice_id: number | null
  attempt_discriminator: number
  created_at: string
}

type DunningContactRow = {
  id: number
  customer_id: number | null
  email: string | null
}

type DunningPreferenceRow = {
  contact_id: number
  nature: string
  enabled: boolean
}

type SuppressionRow = { email: string; reason?: string | null }

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime())
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(value)
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value?.trim()) return null
  const parsed = new Date(value.includes('T') ? value : `${value}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function demurrageDunningPauseReason(invoice: Pick<DemurrageInvoice, 'paid_at' | 'dispute_open'>, hasValidContact: boolean): string | null {
  if (invoice.paid_at) return 'liquidada'
  if (invoice.dispute_open) return 'disputa aberta'
  if (!hasValidContact) return 'cliente sem contatos válidos'
  return null
}

export function getDemurrageDunningDisplay(
  invoice: Pick<DemurrageInvoice, 'id' | 'first_billed_at' | 'paid_at' | 'dispute_open'>,
  input: { attempts?: readonly DemurrageDunningAttempt[]; attemptCount?: number; lastAttemptAt?: string | null; hasValidContact?: boolean; intervalDays?: number; now?: Date } = {},
): DemurrageDunningDisplay {
  const attempts = input.attempts ?? []
  const attemptCount = input.attemptCount ?? attempts.length
  const pauseReason = demurrageDunningPauseReason(invoice, input.hasValidContact ?? true)
  const firstBilledAt = parseDate(invoice.first_billed_at)
  const intervalDays = Math.max(1, Math.trunc(input.intervalDays ?? 7))
  const nextDate = firstBilledAt && !pauseReason
    ? addDays(firstBilledAt, attemptCount * intervalDays)
    : null
  const nextAttemptNumber = attemptCount + 1
  const lastAttemptAt = input.lastAttemptAt ?? attempts
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]?.createdAt ?? null

  let statusLabel = `${nextAttemptNumber}ª cobrança`
  if (pauseReason === 'liquidada') statusLabel = 'Régua encerrada: liquidada'
  else if (pauseReason) statusLabel = `Pausada: ${pauseReason}`
  else if (nextDate) statusLabel += `, próxima em ${formatDate(nextDate)}`
  else statusLabel = 'Aguardando primeira emissão'

  return {
    invoiceId: invoice.id,
    attemptCount,
    nextAttemptNumber,
    nextDate: nextDate?.toISOString() ?? null,
    statusLabel,
    pauseReason,
    lastAttemptAt,
  }
}

export function nextDemurrageDunningAttemptNumber(attempts: readonly Pick<DemurrageDunningAttempt, 'attemptDiscriminator'>[]): number {
  return attempts.length ? Math.max(...attempts.map((attempt) => attempt.attemptDiscriminator)) + 1 : 1
}

function normalizedEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

/** Lê o ponto da régua sem expor o claim server-side à escrita do navegador. */
export async function fetchDemurrageDunningStatuses(
  invoices: readonly Pick<DemurrageInvoice, 'id' | 'customer_id'>[],
): Promise<Map<number, DemurrageDunningStatusRow>> {
  const invoiceIds = [...new Set(invoices.map((invoice) => invoice.id))]
  if (!invoiceIds.length) return new Map()
  const customerIds = [...new Set(invoices.map((invoice) => invoice.customer_id))]
  const [communicationsResult, contactsResult, preferencesResult, communicationSuppressionsResult, portalSuppressionsResult, settingsResult] = await Promise.all([
    supabase.from('customer_communications')
      .select('anchor_invoice_id, attempt_discriminator, created_at')
      .eq('kind', 'cobranca_demurrage')
      .in('anchor_invoice_id', invoiceIds)
      .order('created_at', { ascending: true })
      .overrideTypes<DunningCommunicationRow[], { merge: false }>(),
    supabase.from('customer_contacts').select('id, customer_id, email').in('customer_id', customerIds),
    supabase.from('customer_contact_preferences').select('contact_id, nature, enabled'),
    supabase.from('customer_communication_suppressions').select('email, reason'),
    supabase.from('portal_suppressed_emails').select('email, reason'),
    supabase.from('app_settings').select('demurrage_dunning_interval_days').eq('id', 1).maybeSingle(),
  ])
  if (communicationsResult.error) throw communicationsResult.error
  if (contactsResult.error) throw contactsResult.error
  if (preferencesResult.error) throw preferencesResult.error
  if (communicationSuppressionsResult.error) throw communicationSuppressionsResult.error
  if (portalSuppressionsResult.error) throw portalSuppressionsResult.error
  if (settingsResult.error) throw settingsResult.error
  const intervalDays = Math.max(1, Number((settingsResult.data as { demurrage_dunning_interval_days?: number } | null)?.demurrage_dunning_interval_days ?? 7))

  const contacts = (contactsResult.data ?? []) as DunningContactRow[]
  const preferences = (preferencesResult.data ?? []) as DunningPreferenceRow[]
  const communicationSuppressions = (communicationSuppressionsResult.data ?? []) as SuppressionRow[]
  const portalSuppressions = (portalSuppressionsResult.data ?? []) as SuppressionRow[]
  const isValidContact = (contact: DunningContactRow) => {
    const email = normalizedEmail(contact.email)
    if (!email) return false
    if (communicationSuppressions.some((row) => normalizedEmail(row.email) === email)) return false
    if (portalSuppressions.some((row) => normalizedEmail(row.email) === email && row.reason === 'bounce_permanente')) return false
    return preferences.find((row) => row.contact_id === contact.id && row.nature === 'demurrage')?.enabled !== false
  }
  const validByCustomer = new Map<number, boolean>()
  for (const customerId of customerIds) validByCustomer.set(customerId, contacts.some((contact) => contact.customer_id === customerId && isValidContact(contact)))

  const byInvoice = new Map<number, DunningCommunicationRow[]>()
  for (const row of (communicationsResult.data ?? []) as DunningCommunicationRow[]) {
    if (row.anchor_invoice_id == null) continue
    const current = byInvoice.get(row.anchor_invoice_id) ?? []
    current.push(row)
    byInvoice.set(row.anchor_invoice_id, current)
  }
  return new Map(invoices.map((invoice) => {
    const rows = byInvoice.get(invoice.id) ?? []
    const last = rows[rows.length - 1]
    return [invoice.id, {
      invoiceId: invoice.id,
      attemptCount: rows.length,
      lastAttemptAt: last?.created_at ?? null,
      hasValidContact: validByCustomer.get(invoice.customer_id) ?? false,
      intervalDays,
    } satisfies DemurrageDunningStatusRow]
  }))
}
