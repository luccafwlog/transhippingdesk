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

  // B13: separate maps per source to detect cross-source collisions instead of silently overwriting
  const localMap: Record<string, InvEntry | null> = {}
  for (const inv of localInvoices) {
    const docNum = inv.invoice_number ?? String(inv.id)
    const key = normTxid(docNum)
    if (!key) continue
    // null marks intra-source collision — skip both
    localMap[key] = key in localMap ? null : { source: 'local', id: inv.id, docNumber: docNum, customerName: inv.customer?.name ?? '', customerCnpj: onlyDigits(inv.customer?.cnpj_cpf ?? ''), amount: inv.balance_brl ?? inv.total_brl ?? 0 }
  }

  const demurrageMap: Record<string, InvEntry | null> = {}
  for (const inv of demurrageInvoices) {
    const key = normTxid(inv.doc_number)
    if (!key) continue
    demurrageMap[key] = key in demurrageMap ? null : { source: 'demurrage', id: inv.id, docNumber: inv.doc_number, customerName: inv.customer?.name ?? '', customerCnpj: onlyDigits(inv.customer?.cnpj_cpf ?? ''), amount: inv.frozen_total_brl ?? 0 }
  }

  const matches: UnifiedPixMatch[] = []
  for (const tx of transactions) {
    const key = normTxid(tx.txid)
    if (!key || usedTxids.has(key)) continue

    const local = localMap[key]
    const demurrage = demurrageMap[key]

    if (!local && !demurrage) continue

    // B13+B14: same TXID key exists in both maps → ambiguous, surface both candidates
    if (key in localMap && key in demurrageMap) {
      if (local) matches.push({ transaction: tx, source: local.source, invoiceId: local.id, docNumber: local.docNumber, customerName: local.customerName, customerCnpj: local.customerCnpj, amount: local.amount, ambiguous: true, matchType: 'txid' })
      if (demurrage) matches.push({ transaction: tx, source: demurrage.source, invoiceId: demurrage.id, docNumber: demurrage.docNumber, customerName: demurrage.customerName, customerCnpj: demurrage.customerCnpj, amount: demurrage.amount, ambiguous: true, matchType: 'txid' })
      continue
    }

    // intra-source collision (null): skip entirely
    const e = local ?? demurrage
    if (!e) continue

    // B16: for demurrage, mark ambiguous when value diverges (so UI shows warning instead of "sem conflito")
    const ambiguous = e.source === 'demurrage' && (Math.abs(tx.amount - e.amount) > 0.01 || !Number.isFinite(tx.amount - e.amount))
    matches.push({ transaction: tx, source: e.source, invoiceId: e.id, docNumber: e.docNumber, customerName: e.customerName, customerCnpj: e.customerCnpj, amount: e.amount, ambiguous, matchType: 'txid' })
  }

  return matches
}

export async function confirmUnifiedPixReconciliation(matches: UnifiedPixMatch[]): Promise<{ local: number; demurrage: number }> {
  let local = 0
  const today = new Date().toISOString().slice(0, 10)
  const demurrageUpdates: Array<{ invoice_id: number; paid_at: string; pix_txid: string }> = []

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
      demurrageUpdates.push({ invoice_id: m.invoiceId, paid_at: paidAt, pix_txid: m.transaction.txid })
    }
  }

  // Demurrage conciliada em lote: uma round-trip para o batch inteiro em vez
  // de um UPDATE por fatura. A RPC retorna quantas linhas atualizou de fato.
  let demurrage = 0
  if (demurrageUpdates.length > 0) {
    const { data, error } = await supabase.rpc(
      'confirm_demurrage_pix_matches' as never,
      { p_matches: demurrageUpdates } as never,
    )
    if (error) throw error
    demurrage = Number(data ?? 0)
    if (demurrage !== demurrageUpdates.length) {
      throw new Error(`Conciliação de demurrage atualizou ${demurrage} de ${demurrageUpdates.length} faturas.`)
    }
  }

  return { local, demurrage }
}
