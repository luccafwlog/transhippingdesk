import { supabase } from './supabase'
import { buildDependencyReport, tallyReasons, type DeleteDependencyReport } from './deleteDependencies'
import { logDeletions } from './deleteAudit'

/**
 * Verifica bloqueadores de exclusao de containers (`bl_containers`). Containers
 * com calculo de taxa local ou item de demurrage vinculado nao podem ser
 * excluidos (integridade fiscal). Veiculos vinculados NAO bloqueiam: eles sao
 * apagados em cascata controlada por `deleteContainers`.
 */
export async function checkContainerDependencies(ids: number[]): Promise<DeleteDependencyReport<number>> {
  if (ids.length === 0) return { deletableIds: [], blockedIds: [] }

  const [charges, demurrageItems] = await Promise.all([
    supabase.from('charge_calculations').select('container_id').in('container_id', ids),
    supabase.from('demurrage_invoice_items').select('container_id').in('container_id', ids),
  ])
  if (charges.error) throw charges.error
  if (demurrageItems.error) throw demurrageItems.error

  const reasons = new Map<number, string[]>()
  tallyReasons(reasons, charges.data ?? [], 'container_id', (count) => `${count} calculo(s) de taxa vinculado(s)`)
  tallyReasons(reasons, demurrageItems.data ?? [], 'container_id', (count) => `${count} item(ns) de demurrage vinculado(s)`)

  return buildDependencyReport(ids, reasons)
}

/**
 * Exclui containers e os veiculos vinculados a eles. Apaga primeiro os veiculos
 * (`vehicles.container_id` e RESTRICT) e depois os containers. Os filhos em
 * cascata do banco (ex: baplie_reconciliation_resolutions) somem junto.
 * Pressupoe que os ids ja passaram por `checkContainerDependencies`.
 */
export async function deleteContainers(ids: number[], changedBy?: string | null) {
  if (ids.length === 0) return

  const vehicles = await supabase.from('vehicles').delete().in('container_id', ids)
  if (vehicles.error) throw vehicles.error

  const containers = await supabase.from('bl_containers').delete().in('id', ids)
  if (containers.error) throw containers.error

  await logDeletions('container', ids, changedBy)
}
