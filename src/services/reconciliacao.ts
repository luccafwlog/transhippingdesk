import { onlyDigits } from '../lib/utils'
import { supabase } from './supabase'
import type { PixTransaction } from '../types/database'

export type UnifiedPixMatch = {
  transaction: PixTransaction
  source: 'local' | 'demurrage'
  invoiceId: number
  docNumber: string
  customerName: string
  customerCnpj: string
  amount: number
  ambiguous: boolean
  ambiguityReason?: string
  candidateCount?: number
  matchType: 'txid'
}

export type UnifiedPixConfirmationResult = {
  local: number
  demurrage: number
  items: Array<{ source: 'local' | 'demurrage'; invoice_id: number; doc_number: string; status: 'ok' }>
}

function normTxid(str: string) {
  return (str ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

export async function matchUnifiedPixTransactions(transactions: PixTransaction[]): Promise<UnifiedPixMatch[]> {
  type LocalInv = {
    id: number
    invoice_number: string | null
    total_brl: number | null
    balance_brl: number | null
    pix_txid: string | null
    customer: { name: string; cnpj_cpf: string } | null
  }
  type DemurrageInv = {
    id: number
    doc_number: string
    frozen_total_brl: number | null
    pix_txid: string | null
    customer: { name: string; cnpj_cpf: string } | null
  }

  const [localRes, demurrageRes] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, invoice_number, total_brl, balance_brl, status, pix_txid, customer:customers(id, name, cnpj_cpf)')
      .in('status', ['issued', 'partially_paid', 'overdue'])
      .in('invoice_type', ['individual', 'consolidated'])
      .overrideTypes<LocalInv[], { merge: false }>(),
    supabase
      .from('demurrage_invoices')
      .select('id, doc_number, frozen_total_brl, status, pix_txid, customer:customers(id, name, cnpj_cpf)')
      .eq('status', 'issued')
      .overrideTypes<DemurrageInv[], { merge: false }>(),
  ])

  if (localRes.error) throw localRes.error
  if (demurrageRes.error) throw demurrageRes.error

  const localInvoices = localRes.data ?? []
  const demurrageInvoices = demurrageRes.data ?? []

  const usedTxids = new Set<string>(
    [
      ...localInvoices.map((i) => i.pix_txid ?? '').filter(Boolean),
      ...demurrageInvoices.map((i) => i.pix_txid ?? '').filter(Boolean),
    ].map(normTxid).filter(Boolean),
  )

  type InvEntry = {
    source: 'local' | 'demurrage'
    id: number
    docNumber: string
    customerName: string
    customerCnpj: string
    amount: number
  }

  const txidMap = new Map<string, InvEntry[]>()

  for (const inv of localInvoices) {
    const docNum = inv.invoice_number ?? String(inv.id)
    const entry: InvEntry = {
      source: 'local',
      id: inv.id,
      docNumber: docNum,
      customerName: inv.customer?.name ?? '',
      customerCnpj: onlyDigits(inv.customer?.cnpj_cpf ?? ''),
      amount: inv.balance_brl ?? inv.total_brl ?? 0,
    }
    const key = normTxid(docNum)
    if (key) txidMap.set(key, [...(txidMap.get(key) ?? []), entry])
  }

  for (const inv of demurrageInvoices) {
    const entry: InvEntry = {
      source: 'demurrage',
      id: inv.id,
      docNumber: inv.doc_number,
      customerName: inv.customer?.name ?? '',
      customerCnpj: onlyDigits(inv.customer?.cnpj_cpf ?? ''),
      amount: inv.frozen_total_brl ?? 0,
    }
    const key = normTxid(inv.doc_number)
    if (key) txidMap.set(key, [...(txidMap.get(key) ?? []), entry])
  }

  const matches: UnifiedPixMatch[] = []
  for (const tx of transactions) {
    const key = normTxid(tx.txid)
    if (key && usedTxids.has(key)) continue

    const entries = key ? txidMap.get(key) ?? [] : []
    if (!entries.length) continue

    const entry = entries[0]
    const amountDiff = tx.amount - entry.amount
    let ambiguityReason: string | undefined
    if (entries.length > 1) {
      ambiguityReason = `${entries.length} documentos usam o mesmo TXID.`
    } else if (!Number.isFinite(amountDiff)) {
      ambiguityReason = 'Valor do documento nao e numerico.'
    } else if (entry.source === 'demurrage' && Math.abs(amountDiff) > 0.01) {
      ambiguityReason = 'Valor do PIX diverge da demurrage emitida.'
    } else if (entry.source === 'local' && amountDiff > 0.01) {
      ambiguityReason = 'Valor do PIX supera o saldo aberto da fatura.'
    }

    matches.push({
      transaction: tx,
      source: entry.source,
      invoiceId: entry.id,
      docNumber: entry.docNumber,
      customerName: entry.customerName,
      customerCnpj: entry.customerCnpj,
      amount: entry.amount,
      ambiguous: Boolean(ambiguityReason),
      ambiguityReason,
      candidateCount: entries.length,
      matchType: 'txid',
    })
  }

  return matches
}

export async function confirmUnifiedPixReconciliation(matches: UnifiedPixMatch[]): Promise<UnifiedPixConfirmationResult> {
  const payload = matches
    .filter((match) => !match.ambiguous)
    .map((match) => {
      const paidAt = match.transaction.date
      if (!paidAt) {
        throw new Error(`Data do extrato nao parseada para ${match.docNumber}.`)
      }

      return {
        source: match.source,
        invoice_id: match.invoiceId,
        doc_number: match.docNumber,
        txid: match.transaction.txid,
        amount: match.transaction.amount,
        expected_amount: match.amount,
        paid_at: paidAt,
      }
    })

  const { data, error } = await supabase.rpc('confirm_unified_pix_matches' as never, {
    p_matches: payload,
  } as never)
  if (error) throw error

  const result = (data ?? {}) as UnifiedPixConfirmationResult
  return {
    local: Number(result.local ?? 0),
    demurrage: Number(result.demurrage ?? 0),
    items: Array.isArray(result.items) ? result.items : [],
  }
}

// ========== Reconciliation History ==========

export type ReconciliationHistoryRow = {
  id: string
  source: 'local' | 'demurrage'
  invoiceId: number
  docNumber: string
  invoiceType: string | null
  customerName: string
  customerCnpj: string
  blId: string
  vesselName: string | null
  voyageNumber: string | null
  pod: string | null
  blAmount: number
  totalAmount: number
  totalPaid: number | null
  balance: number | null
  paidAt: string | null
  status: string
}

export type ReconciliationFilters = {
  paidFrom: string
  paidTo: string
  source: '' | 'local' | 'demurrage'
  customerId: string
  blSearch: string
  voyageSearch: string
  pod: string
  sort: string
  sortDir: 'asc' | 'desc'
  page: number
  pageSize: number
}

const DEFAULT_HISTORY_FILTERS: ReconciliationFilters = {
  paidFrom: '',
  paidTo: '',
  source: '',
  customerId: '',
  blSearch: '',
  voyageSearch: '',
  pod: '',
  sort: 'paidAt',
  sortDir: 'desc',
  page: 1,
  pageSize: 50,
}

const HISTORY_LOCAL_SELECT = `
  id, invoice_number, customer_id, bl_id, issued_at, due_date, total_brl, status, invoice_type,
  total_paid_brl, balance_brl, created_at,
  customer:customers(id,name,cnpj_cpf),
  invoice_bls(id,bl_id,subtotal_brl,subtotal_usd,bl:bls(pod,voyage:voyages(voyage_number,vessel:vessels(name)))),
  invoice_receivable_links(id,bl_id,subtotal_brl,bl:bls(pod,voyage:voyages(voyage_number,vessel:vessels(name)))),
  payments(paid_at)
`

const HISTORY_DEMURRAGE_SELECT = `
  *, customer:customers(id,name,cnpj_cpf),
  bl:bls(id,pol,pod,voyage:voyages(id,voyage_number,vessel:vessels(id,name)))
`

type FlatBl = { blId: string; pod: string | null; voyageNumber: string | null; vesselName: string | null; subtotalBrl: number | null }

function flattenBls(inv: Record<string, unknown>): FlatBl[] {
  const invoiceBls = (inv.invoice_bls as Array<Record<string, unknown>> | null) ?? []
  const receivableLinks = (inv.invoice_receivable_links as Array<Record<string, unknown>> | null) ?? []
  const links = invoiceBls.length > 0 ? invoiceBls : receivableLinks
  const out = links
    .map((link: Record<string, unknown>) => {
      const bl = link.bl as Record<string, unknown> | null
      const voyage = bl?.voyage as Record<string, unknown> | null
      return {
        blId: String(link.bl_id ?? '').trim(),
        pod: (bl?.pod as string | null) ?? null,
        voyageNumber: (voyage?.voyage_number as string | null) ?? null,
        vesselName: ((voyage?.vessel as Record<string, unknown> | null)?.name as string | null) ?? null,
        subtotalBrl: (link.subtotal_brl as number | null) ?? null,
      }
    })
    .filter((bl) => bl.blId.length > 0)
  return out.length > 0 ? out : [{ blId: '-', pod: null, voyageNumber: null, vesselName: null, subtotalBrl: null }]
}

export async function listReconciliationHistory(
  userFilters: Partial<ReconciliationFilters>,
): Promise<{ rows: ReconciliationHistoryRow[]; totalCount: number }> {
  const filters: ReconciliationFilters = { ...DEFAULT_HISTORY_FILTERS, ...userFilters }

  const [localPromise, demurragePromise] = await Promise.all([
    (() => {
      let q = supabase
        .from('invoices')
        .select(HISTORY_LOCAL_SELECT)
        .in('status', ['paid', 'covered', 'partially_paid'])
        .order('created_at', { ascending: false })
        .limit(2000)
      if (filters.customerId) q = q.eq('customer_id', Number(filters.customerId))
      return q.overrideTypes<Record<string, unknown>[]>()
    })(),
    (() => {
      let q = supabase
        .from('demurrage_invoices')
        .select(HISTORY_DEMURRAGE_SELECT)
        .eq('status', 'paid')
        .order('created_at', { ascending: false })
        .limit(2000)
      if (filters.customerId) q = q.eq('customer_id', Number(filters.customerId))
      return q.overrideTypes<Record<string, unknown>[]>()
    })(),
  ])

  if (localPromise.error) throw localPromise.error
  if (demurragePromise.error) throw demurragePromise.error

  const localRows: ReconciliationHistoryRow[] = []
  for (const inv of localPromise.data ?? []) {
    const bls = flattenBls(inv)
    const dates = ((inv.payments as Array<{ paid_at: string | null }> | null) ?? [])
      .map((p) => p.paid_at)
      .filter((d): d is string => Boolean(d))
    const paymentDate = dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : null

    const invTotal = Number(inv.total_brl ?? 0)
    for (const bl of bls) {
      localRows.push({
        id: `local-${inv.id}-${bl.blId}`,
        source: 'local',
        invoiceId: Number(inv.id),
        docNumber: (inv.invoice_number as string | null) ?? `INV-${inv.id}`,
        invoiceType: (inv.invoice_type as string | null) ?? null,
        customerName: ((inv.customer as Record<string, unknown> | null)?.name as string) ?? '',
        customerCnpj: ((inv.customer as Record<string, unknown> | null)?.cnpj_cpf as string) ?? '',
        blId: bl.blId,
        vesselName: bl.vesselName,
        voyageNumber: bl.voyageNumber,
        pod: bl.pod,
        blAmount: bl.subtotalBrl ?? invTotal,
        totalAmount: invTotal,
        totalPaid: inv.total_paid_brl != null ? Number(inv.total_paid_brl) : null,
        balance: inv.balance_brl != null ? Number(inv.balance_brl) : null,
        paidAt: paymentDate,
        status: (inv.status as string) ?? '',
      })
    }
  }

  const demurrageRows: ReconciliationHistoryRow[] = []
  for (const inv of demurragePromise.data ?? []) {
    const voyage = (inv.bl as Record<string, unknown> | null)?.voyage as Record<string, unknown> | null
    const invTotal = Number(inv.frozen_total_brl ?? 0)
    demurrageRows.push({
      id: `demurrage-${inv.id}`,
      source: 'demurrage',
      invoiceId: Number(inv.id),
      docNumber: (inv.doc_number as string) ?? '',
      invoiceType: null,
      customerName: ((inv.customer as Record<string, unknown> | null)?.name as string) ?? '',
      customerCnpj: ((inv.customer as Record<string, unknown> | null)?.cnpj_cpf as string) ?? '',
      blId: (inv.bl_id as string) ?? '',
      vesselName: (voyage?.vessel as Record<string, unknown> | null)?.name as string | null ?? null,
      voyageNumber: voyage?.voyage_number as string | null ?? null,
      pod: ((inv.bl as Record<string, unknown> | null)?.pod as string | null) ?? null,
      blAmount: invTotal,
      totalAmount: invTotal,
      totalPaid: null,
      balance: null,
      paidAt: (inv.paid_at as string | null) ?? null,
      status: (inv.status as string) ?? '',
    })
  }

  let all = [...localRows, ...demurrageRows]

  if (filters.paidFrom) all = all.filter((r) => r.paidAt !== null && r.paidAt! >= filters.paidFrom)
  if (filters.paidTo) all = all.filter((r) => r.paidAt !== null && r.paidAt! <= `${filters.paidTo}T23:59:59`)
  if (filters.source) all = all.filter((r) => r.source === filters.source)
  if (filters.blSearch) {
    const term = filters.blSearch.toUpperCase()
    all = all.filter((r) => r.blId.toUpperCase().includes(term))
  }
  if (filters.voyageSearch) {
    const term = filters.voyageSearch.toUpperCase()
    all = all.filter((r) => (r.vesselName?.toUpperCase() ?? '').includes(term) || (r.voyageNumber?.toUpperCase() ?? '').includes(term))
  }
  if (filters.pod) {
    const term = filters.pod.toUpperCase()
    all = all.filter((r) => (r.pod?.toUpperCase() ?? '').includes(term))
  }

  const sf = filters.sort || 'paidAt'
  const sd = filters.sortDir || 'desc'
  all.sort((a, b) => {
    let cmp = 0
    if (sf === 'paidAt') cmp = (a.paidAt ?? '').localeCompare(b.paidAt ?? '')
    else if (sf === 'docNumber') cmp = a.docNumber.localeCompare(b.docNumber)
    else if (sf === 'customerName') cmp = a.customerName.localeCompare(b.customerName)
    else if (sf === 'blAmount') cmp = a.blAmount - b.blAmount
    else if (sf === 'totalAmount') cmp = a.totalAmount - b.totalAmount
    else if (sf === 'blId') cmp = a.blId.localeCompare(b.blId)
    return sd === 'desc' ? -cmp : cmp
  })

  const totalCount = all.length
  const from = (filters.page - 1) * filters.pageSize
  const rows = all.slice(from, from + filters.pageSize)

  return { rows, totalCount }
}

export async function exportReconciliationHistoryExcel(filters: Partial<ReconciliationFilters>) {
  const { rows } = await listReconciliationHistory({ ...filters, page: 1, pageSize: 999999 })

  const XLSX = await import('@e965/xlsx')

  const data = rows.map((r) => ({
    Tipo: r.source === 'demurrage' ? 'Demurrage' : 'Taxas Locais',
    'Nº Documento': r.docNumber,
    'Tipo Doc.': r.source === 'demurrage' ? '—' : r.invoiceType === 'consolidated' ? 'Consolidada' : 'Único BL',
    Consignatário: r.customerName,
    CNPJ: r.customerCnpj,
    'B/L': r.blId,
    'Valor BL': r.blAmount,
    'Valor Total': r.totalAmount,
    Navio: r.vesselName ?? '',
    Viagem: r.voyageNumber ?? '',
    POD: r.pod ?? '',
    'Data Pagamento': r.paidAt ? formatDate(r.paidAt) : '',
    Status: r.status === 'paid' ? 'Paga' : r.status === 'covered' ? 'Coberta' : r.status === 'partially_paid' ? 'Parcial' : r.status,
  }))

  const safeRows = data.map((row) => {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value)) {
        out[key] = `'${value}`
      } else {
        out[key] = value
      }
    }
    return out
  })

  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.json_to_sheet(safeRows)
  XLSX.utils.book_append_sheet(workbook, sheet, 'Conciliação')
  const now = new Date()
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('')
  XLSX.writeFile(workbook, `conciliacao-${ts}.xlsx`)
}
