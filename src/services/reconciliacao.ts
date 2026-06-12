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
    const amountDiff = Math.abs(tx.amount - entry.amount)
    const ambiguous =
      entries.length > 1 ||
      (entry.source === 'demurrage' && (!Number.isFinite(amountDiff) || amountDiff > 0.01))

    matches.push({
      transaction: tx,
      source: entry.source,
      invoiceId: entry.id,
      docNumber: entry.docNumber,
      customerName: entry.customerName,
      customerCnpj: entry.customerCnpj,
      amount: entry.amount,
      ambiguous,
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
