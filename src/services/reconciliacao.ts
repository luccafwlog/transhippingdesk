import { onlyDigits } from '../lib/utils'
import { reconcileInvoicePaymentByTxid } from './billingLedger'
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

function normTxid(str: string) {
  return (str ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

export async function matchUnifiedPixTransactions(transactions: PixTransaction[]): Promise<UnifiedPixMatch[]> {
  type LocalInv = { id: number; invoice_number: string | null; total_brl: number | null; balance_brl: number | null; pix_txid: string | null; customer: { name: string; cnpj_cpf: string } | null }
  type DemurrageInv = { id: number; doc_number: string; frozen_total_brl: number | null; pix_txid: string | null; customer: { name: string; cnpj_cpf: string } | null }

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

  const usedTxids = new Set<string>([
    ...localInvoices.map((i) => i.pix_txid ?? '').filter(Boolean),
    ...demurrageInvoices.map((i) => i.pix_txid ?? '').filter(Boolean),
  ].map(normTxid).filter(Boolean))

  type InvEntry = { source: 'local' | 'demurrage'; id: number; docNumber: string; customerName: string; customerCnpj: string; amount: number }

  const txidMap: Record<string, InvEntry> = {}

  for (const inv of localInvoices) {
    const docNum = inv.invoice_number ?? String(inv.id)
    const entry: InvEntry = { source: 'local', id: inv.id, docNumber: docNum, customerName: inv.customer?.name ?? '', customerCnpj: onlyDigits(inv.customer?.cnpj_cpf ?? ''), amount: inv.balance_brl ?? inv.total_brl ?? 0 }
    const key = normTxid(docNum)
    if (key) txidMap[key] = entry
  }

  for (const inv of demurrageInvoices) {
    const entry: InvEntry = { source: 'demurrage', id: inv.id, docNumber: inv.doc_number, customerName: inv.customer?.name ?? '', customerCnpj: onlyDigits(inv.customer?.cnpj_cpf ?? ''), amount: inv.frozen_total_brl ?? 0 }
    const key = normTxid(inv.doc_number)
    if (key) txidMap[key] = entry
  }

  const matches: UnifiedPixMatch[] = []
  for (const tx of transactions) {
    const key = normTxid(tx.txid)
    if (key && usedTxids.has(key)) continue
    if (key && txidMap[key]) {
      const e = txidMap[key]
      matches.push({ transaction: tx, source: e.source, invoiceId: e.id, docNumber: e.docNumber, customerName: e.customerName, customerCnpj: e.customerCnpj, amount: e.amount, ambiguous: false, matchType: 'txid' })
    }
  }

  return matches
}

export async function confirmUnifiedPixReconciliation(matches: UnifiedPixMatch[]): Promise<{ local: number; demurrage: number }> {
  let local = 0
  let demurrage = 0
  const today = new Date().toISOString().slice(0, 10)

  for (const m of matches) {
    if (m.ambiguous) continue
    const paidAt = m.transaction.date || today

    if (m.source === 'local') {
      const result = await reconcileInvoicePaymentByTxid({
        txid: m.transaction.txid,
        amountBrl: m.transaction.amount,
        paidAt,
      })
      if (!result.matched || !result.settled) {
        throw new Error(result.reason ?? 'Falha ao conciliar fatura local por TXID.')
      }
      local += 1
    } else {
      const diff = Math.abs(m.transaction.amount - m.amount)
      if (!Number.isFinite(diff) || diff > 0.01) {
        throw new Error(`Valor divergente para demurrage ${m.docNumber}.`)
      }

      const { error } = await supabase.from('demurrage_invoices').update({ status: 'paid', paid_at: paidAt, pix_txid: m.transaction.txid, conciliated_by_extract: true }).eq('id', m.invoiceId)
      if (error) throw error
      demurrage += 1
    }
  }

  return { local, demurrage }
}
