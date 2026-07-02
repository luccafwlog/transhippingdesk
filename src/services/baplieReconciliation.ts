import { supabase } from './supabase'
import type { BLContainer, BaplieContainer as BaplieContainerRow } from '../types/database'

// Baplie/EDI é soberano para as flags físicas (is_imo, imo_class, un_number,
// is_oog) — CONTEXT.md. Portanto a conciliação NÃO aponta divergência de
// atributo: o valor do Baplie é aplicado automaticamente ao B/L. A única
// divergência apontada é de EXISTÊNCIA: container no Baplie e em nenhum B/L, ou
// em B/L e ausente do Baplie (#306).
export type BaplieReconciliationItem =
  | {
      kind: 'missing_in_manifest'
      container_number: string
      baplie_bl_ref: string | null
      slot: string | null
    }
  | {
      kind: 'missing_in_baplie'
      container_number: string
      bl_container_id: number
      bl_number: string | null
    }

export type BaplieReconciliationResult = {
  items: BaplieReconciliationItem[]
}

type BlContainerPhysical = Pick<
  BLContainer,
  'id' | 'bl_id' | 'container_number' | 'is_imo' | 'imo_class' | 'un_number' | 'is_oog'
>

export type BapliePhysicalUpdate = {
  bl_container_id: number
  is_imo: boolean
  imo_class: string | null
  un_number: string | null
  is_oog: boolean
}

/** Divergências de existência (pura, testável) — as duas direções. */
export function computeExistenceDivergences(
  staged: BaplieContainerRow[],
  blContainers: BlContainerPhysical[],
): BaplieReconciliationItem[] {
  const items: BaplieReconciliationItem[] = []

  const blByNumber = new Map<string, BlContainerPhysical[]>()
  for (const c of blContainers) {
    const key = normalizeContainerNumber(c.container_number)
    const list = blByNumber.get(key) ?? []
    list.push(c)
    blByNumber.set(key, list)
  }

  const baplieFullNumbers = new Set<string>()
  for (const b of staged) {
    if (b.status === 'empty') continue
    baplieFullNumbers.add(normalizeContainerNumber(b.container_number))
  }

  // Container no Baplie (full) e em nenhum B/L.
  for (const b of staged) {
    if (b.status === 'empty') continue
    const key = normalizeContainerNumber(b.container_number)
    if (!blByNumber.has(key)) {
      items.push({
        kind: 'missing_in_manifest',
        container_number: b.container_number,
        baplie_bl_ref: b.bl_ref,
        slot: b.slot,
      })
    }
  }

  // Container em B/L e ausente do Baplie (full).
  for (const mc of blContainers) {
    const key = normalizeContainerNumber(mc.container_number)
    if (!baplieFullNumbers.has(key)) {
      items.push({
        kind: 'missing_in_baplie',
        container_number: mc.container_number,
        bl_container_id: mc.id,
        bl_number: (mc.bl_id as string) ?? null,
      })
    }
  }

  return items
}

/**
 * Flags físicas do Baplie que devem sobrescrever o B/L (pura, testável). Para
 * cada container full do Baplie que casa com exatamente um bl_container, se
 * qualquer flag física diferir, produz um update com os valores do Baplie.
 * Quando o Baplie não é IMO, zera classe/ONU.
 */
export function computeBapliePhysicalUpdates(
  staged: BaplieContainerRow[],
  blContainers: BlContainerPhysical[],
): BapliePhysicalUpdate[] {
  const blByNumber = new Map<string, BlContainerPhysical[]>()
  for (const c of blContainers) {
    const key = normalizeContainerNumber(c.container_number)
    const list = blByNumber.get(key) ?? []
    list.push(c)
    blByNumber.set(key, list)
  }

  const updates: BapliePhysicalUpdate[] = []
  for (const b of staged) {
    if (b.status === 'empty') continue
    const matches = blByNumber.get(normalizeContainerNumber(b.container_number))
    if (!matches || matches.length !== 1) continue
    const mc = matches[0]

    const isImo = Boolean(b.is_imo)
    const imoClass = isImo ? (b.imo_class ?? null) : null
    const unNumber = isImo ? (b.un_number ?? null) : null
    const isOog = Boolean(b.is_oog)

    const differs =
      isImo !== Boolean(mc.is_imo) ||
      isOog !== Boolean(mc.is_oog) ||
      normalizeVal(imoClass) !== normalizeVal(mc.imo_class) ||
      normalizeVal(unNumber) !== normalizeVal(mc.un_number)

    if (differs) {
      updates.push({ bl_container_id: mc.id, is_imo: isImo, imo_class: imoClass, un_number: unNumber, is_oog: isOog })
    }
  }
  return updates
}

async function fetchStagingAndBlContainers(voyageId: number) {
  const { data: blRows, error: blError } = await supabase.from('bls').select('id').eq('voyage_id', voyageId)
  if (blError) throw blError

  const PAGE = 1000
  const staged: BaplieContainerRow[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('baplie_containers' as never)
      .select('*')
      .eq('voyage_id', voyageId)
      .range(from, from + PAGE - 1)
    if (error) throw error
    staged.push(...((data ?? []) as BaplieContainerRow[]))
    if (!data || data.length < PAGE) break
    from += PAGE
  }

  const blIds = (blRows ?? []).map((b) => b.id)
  const blContainers: BlContainerPhysical[] = []
  if (blIds.length) {
    let fromC = 0
    while (true) {
      const { data, error } = await supabase
        .from('bl_containers')
        .select('id, bl_id, container_number, is_imo, imo_class, un_number, is_oog')
        .in('bl_id', blIds)
        .range(fromC, fromC + PAGE - 1)
      if (error) throw error
      blContainers.push(...((data ?? []) as BlContainerPhysical[]))
      if (!data || data.length < PAGE) break
      fromC += PAGE
    }
  }

  return { staged: dedupeBaplieContainers(staged), blContainers }
}

export async function reconcileBaplieWithManifest(voyageId: number): Promise<BaplieReconciliationResult> {
  const { staged, blContainers } = await fetchStagingAndBlContainers(voyageId)
  if (!staged.length) return { items: [] }
  return { items: computeExistenceDivergences(staged, blContainers) }
}

/**
 * Aplica as flags físicas do Baplie (soberano) aos bl_containers da viagem, com
 * auditoria. Idempotente: só grava onde há diferença. Retorna quantos containers
 * foram atualizados.
 */
export async function applyBapliePhysicalFlags(voyageId: number, actorId: string | null): Promise<number> {
  const { staged, blContainers } = await fetchStagingAndBlContainers(voyageId)
  const updates = computeBapliePhysicalUpdates(staged, blContainers)

  for (const update of updates) {
    const { error } = await supabase
      .from('bl_containers')
      .update({
        is_imo: update.is_imo,
        imo_class: update.imo_class,
        un_number: update.un_number,
        is_oog: update.is_oog,
      })
      .eq('id', update.bl_container_id)
    if (error) throw error

    await supabase.from('audit_logs').insert({
      entity_type: 'bl_container',
      entity_id: String(update.bl_container_id),
      field_name: 'baplie_physical_flags',
      old_value: null,
      new_value: JSON.stringify({
        is_imo: update.is_imo,
        imo_class: update.imo_class,
        un_number: update.un_number,
        is_oog: update.is_oog,
      }),
      changed_by: actorId,
      changed_at: new Date().toISOString(),
      justification: 'Baplie soberano: flags físicas aplicadas automaticamente',
    })
  }

  return updates.length
}

function normalizeVal(v: string | null | undefined) {
  return (v ?? '').toUpperCase()
}

function normalizeContainerNumber(v: string | null | undefined) {
  return (v ?? '').replace(/\s+/g, '').toUpperCase()
}

function dedupeBaplieContainers(rows: BaplieContainerRow[]) {
  const byNumber = new Map<string, BaplieContainerRow>()

  for (const row of rows) {
    const key = normalizeContainerNumber(row.container_number)
    if (!/^[A-Z]{4}\d{7}$/.test(key)) continue

    const existing = byNumber.get(key)
    if (!existing) {
      byNumber.set(key, { ...row, container_number: key })
      continue
    }

    existing.status = existing.status === 'full' || row.status === 'full' ? 'full' : 'empty'
    existing.bl_ref = row.bl_ref ?? existing.bl_ref
    existing.slot = row.slot ?? existing.slot
    existing.is_imo = Boolean(existing.is_imo || row.is_imo)
    existing.imo_class = row.imo_class ?? existing.imo_class
    existing.un_number = row.un_number ?? existing.un_number
    existing.is_oog = Boolean(existing.is_oog || row.is_oog)
  }

  return Array.from(byNumber.values())
}
