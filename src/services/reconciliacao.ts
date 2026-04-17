import { supabase } from './supabase'
import { registerInvoicePayment } from './billing'
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
  matchType: 'txid' | 'cnpj'
}

function normTxid(str: string) {
  return (str ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}
function normCnpj(str: string) {
  return (str ?? '').replace(/\D/g, '')
}

export async function matchUnifiedPixTransactions(transactions: PixTransaction[]): Promise<UnifiedPixMatch[]> {
  const [localRes, demurrageRes] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, invoice_number, total_brl, status, pix_txid, customer:customers(id, name, cnpj_cpf)')
      .in('status', ['issued', 'overdue']),
    supabase
      .from('demurrage_invoices')
      .select('id, doc_number, frozen_total_brl, status, pix_txid, customer:customers(id, name, cnpj_cpf)')
      .eq('status', 'issued'),
  ])

  if (localRes.error) throw localRes.error
  if (demurrageRes.error) throw demurrageRes.error

  type LocalInv = { id: number; invoice_number: string | null; total_brl: number | null; pix_txid: string | null; customer: { name: string; cnpj_cpf: string } | null }
  type DemurrageInv = { id: number; doc_number: string; frozen_total_brl: number | null; pix_txid: string | null; customer: { name: string; cnpj_cpf: string } | null }

  const localInvoices = (localRes.data ?? []) as unknown as LocalInv[]
  const demurrageInvoices = (demurrageRes.data ?? []) as unknown as DemurrageInv[]

  const usedTxids = new Set<string>([
    ...localInvoices.map((i) => i.pix_txid ?? '').filter(Boolean),
    ...demurrageInvoices.map((i) => i.pix_txid ?? '').filter(Boolean),
  ])

  // Build txid and cnpj maps for both sources
  type InvEntry = { source: 'local' | 'demurrage'; id: number; docNumber: string; customerName: string; customerCnpj: string; amount: number }

  const txidMap: Record<string, InvEntry> = {}
  const cnpjMap: Record<string, InvEntry[]> = {}

  for (const inv of localInvoices) {
    const docNum = inv.invoice_number ?? String(inv.id)
    const entry: InvEntry = { source: 'local', id: inv.id, docNumber: docNum, customerName: inv.customer?.name ?? '', customerCnpj: normCnpj(inv.customer?.cnpj_cpf ?? ''), amount: inv.total_brl ?? 0 }
    const key = normTxid(docNum)
    if (key) txidMap[key] = entry
    const cnpj = entry.customerCnpj
    if (cnpj.length === 14) { if (!cnpjMap[cnpj]) cnpjMap[cnpj] = []; cnpjMap[cnpj].push(entry) }
  }

  for (const inv of demurrageInvoices) {
    const entry: InvEntry = { source: 'demurrage', id: inv.id, docNumber: inv.doc_number, customerName: inv.customer?.name ?? '', customerCnpj: normCnpj(inv.customer?.cnpj_cpf ?? ''), amount: inv.frozen_total_brl ?? 0 }
    const key = normTxid(inv.doc_number)
    if (key) txidMap[key] = entry
    const cnpj = entry.customerCnpj
    if (cnpj.length === 14) { if (!cnpjMap[cnpj]) cnpjMap[cnpj] = []; cnpjMap[cnpj].push(entry) }
  }

  const matches: UnifiedPixMatch[] = []
  for (const tx of transactions) {
    if (usedTxids.has(tx.txid)) continue

    const key = normTxid(tx.txid)
    if (key && txidMap[key]) {
      const e = txidMap[key]
      matches.push({ transaction: tx, source: e.source, invoiceId: e.id, docNumber: e.docNumber, customerName: e.customerName, customerCnpj: e.customerCnpj, amount: e.amount, ambiguous: false, matchType: 'txid' })
      continue
    }

    const cnpj = normCnpj(tx.cnpj)
    if (!cnpj || cnpj.length !== 14) continue
    const candidates = (cnpjMap[cnpj] ?? []).filter((e) => Math.abs(e.amount - tx.amount) < 0.02)
    if (!candidates.length) continue
    const e = candidates[0]
    matches.push({ transaction: tx, source: e.source, invoiceId: e.id, docNumber: e.docNumber, customerName: e.customerName, customerCnpj: e.customerCnpj, amount: e.amount, ambiguous: candidates.length > 1, matchType: 'cnpj' })
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
      await registerInvoicePayment({ invoiceId: m.invoiceId, amountBrl: m.transaction.amount, paymentMethod: 'pix', paidAt: paidAt })
      await supabase.from('invoices').update({ pix_txid: m.transaction.txid, conciliated_by_extract: true }).eq('id', m.invoiceId)
      local += 1
    } else {
      await supabase.from('demurrage_invoices').update({ status: 'paid', paid_at: paidAt, pix_txid: m.transaction.txid, conciliated_by_extract: true }).eq('id', m.invoiceId)
      demurrage += 1
    }
  }

  return { local, demurrage }
}
