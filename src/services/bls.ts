import { supabase } from './supabase'
import { buildDependencyReport, tallyReasons, type DeleteDependencyReport } from './deleteDependencies'
import { logDeletions } from './deleteAudit'

/**
 * Verifica bloqueadores fiscais de exclusao de BLs. Um BL ligado a fatura
 * (local ou demurrage), recebivel ou link de recebivel nao pode ser excluido —
 * isso destruiria historico fiscal. Containers, break-bulk, calculos de taxa e
 * veiculos NAO bloqueiam: sao removidos em cascata por `deleteBls`.
 */
export async function checkBlDependencies(ids: string[]): Promise<DeleteDependencyReport<string>> {
  if (ids.length === 0) return { deletableIds: [], blockedIds: [] }

  const [invoices, invoiceBls, receivableLinks, receivables, demurrageInvoices] = await Promise.all([
    supabase.from('invoices').select('bl_id').in('bl_id', ids),
    supabase.from('invoice_bls').select('bl_id').in('bl_id', ids),
    supabase.from('invoice_receivable_links').select('bl_id').in('bl_id', ids),
    supabase.from('bl_receivables').select('bl_id').in('bl_id', ids),
    supabase.from('demurrage_invoices').select('bl_id').in('bl_id', ids),
  ])
  for (const result of [invoices, invoiceBls, receivableLinks, receivables, demurrageInvoices]) {
    if (result.error) throw result.error
  }

  const reasons = new Map<string, string[]>()
  tallyReasons(reasons, invoices.data ?? [], 'bl_id', (count) => `${count} fatura(s) emitida(s)`)
  tallyReasons(reasons, invoiceBls.data ?? [], 'bl_id', () => 'consolidado em fatura')
  tallyReasons(reasons, receivableLinks.data ?? [], 'bl_id', () => 'vinculado a recebivel de fatura')
  tallyReasons(reasons, receivables.data ?? [], 'bl_id', (count) => `${count} recebivel(is) em aberto`)
  tallyReasons(reasons, demurrageInvoices.data ?? [], 'bl_id', (count) => `${count} fatura(s) de demurrage`)

  return buildDependencyReport(ids, reasons)
}

/**
 * Exclui BLs e seus filhos operacionais. Apaga primeiro os veiculos (para evitar
 * o RESTRICT de `vehicles.container_id` durante a cascata) e depois os BLs. O
 * banco cascateia `bl_containers`, `bl_breakbulk_items`, `charge_calculations`,
 * `billing_run_logs` e `customer_reconciliation_queue`. Pressupoe que os ids ja
 * passaram por `checkBlDependencies`.
 */
export async function deleteBls(ids: string[], changedBy?: string | null) {
  if (ids.length === 0) return

  const vehicles = await supabase.from('vehicles').delete().in('bl_id', ids)
  if (vehicles.error) throw vehicles.error

  const bls = await supabase.from('bls').delete().in('id', ids)
  if (bls.error) throw bls.error

  await logDeletions('bl', ids, changedBy)
}
