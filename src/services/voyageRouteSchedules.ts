import { normalizePortCode } from './portCode'
import { supabase } from './supabase'
import { fetchExportSchedulesByVoyageIds } from './voyageExportSchedules'
import type { VoyageExportSchedule, VoyageExportSchedulesByPort } from './voyageExportSchedules'

const POL_ENTITY_TYPE = 'voyage_pol_schedule'
const POD_ENTITY_TYPE = 'voyage_pod_schedule'

export const POD_CE_STATUS_OPTIONS = [
  { value: 'waiting', label: 'Aguardando' },
  { value: 'received', label: 'Recebido' },
  { value: 'launching', label: 'Lançando' },
  { value: 'approving', label: 'Em aprovação' },
  { value: 'approved', label: 'Aprovado' },
] as const

export type EditableVoyagePodCeStatus = (typeof POD_CE_STATUS_OPTIONS)[number]['value']
export type VoyagePodCeStatus = EditableVoyagePodCeStatus | 'partial' | 'missing'

export type VoyagePolSchedule = {
  entityId: string
  voyageId: number
  pol: string
  atd: string | null
  etd: string | null
  escalaNumber: string | null
}

export type VoyagePodSchedule = {
  entityId: string
  voyageId: number
  pod: string
  /** Registros legados sem este campo continuam representando importacao. */
  temImportacao?: boolean
  eta: string | null
  etb: string | null
  ata: string | null
  atb: string | null
  etd: string | null
  atd: string | null
  rtw: number | null
  ceStatus: VoyagePodCeStatus | null
  linked: boolean | null
  escalaNumber: string | null
  /** POD removido do planejamento (soft-delete via audit log). */
  deleted?: boolean
  /** Escala omitida pelo armador (carga descarregada em outro POD). */
  omitted?: boolean
}

export type VoyageEscalaDivergence = {
  field: 'eta' | 'etb' | 'etd' | 'atd' | 'ceStatus' | 'linked' | 'escalaNumber'
  podValue: string | boolean | null
  source: 'pol' | 'export'
  sourceValue: string | boolean | null
}

export type VoyageEscalaSchedule = {
  entityId: string
  voyageId: number
  port: string
  eta: string | null
  etb: string | null
  ata: string | null
  atb: string | null
  etd: string | null
  atd: string | null
  rtw: number | null
  ceStatus: VoyagePodCeStatus | VoyageExportSchedule['ceStatus'] | null
  podCeStatus: VoyagePodCeStatus | null
  exportCeStatus: VoyageExportSchedule['ceStatus'] | null
  linked: boolean | null
  escalaNumber: string | null
  omitted: boolean
  deleted: boolean
  temImportacao: boolean
  temExportacao: boolean
  temGranito: boolean
  containersQty: number | null
  movementsQty: number | null
  /** Portos de descarga declarados no cadastro da exportacao desta escala. */
  dischargePorts: string[]
  divergences: VoyageEscalaDivergence[]
}

type ProjectVoyageEscalaInput = {
  podSchedules?: Iterable<VoyagePodSchedule>
  polSchedules?: Iterable<VoyagePolSchedule>
  exportSchedulesByPort?: VoyageExportSchedulesByPort
}

type VoyageEscalaMergeField = VoyageEscalaDivergence['field']

export function getEditableVoyagePodCeStatus(status: VoyagePodCeStatus | null | undefined): EditableVoyagePodCeStatus {
  if (status === 'approved' || status === 'received' || status === 'launching' || status === 'approving') return status
  if (status === 'partial') return 'launching'
  return 'waiting'
}

export function getVoyagePodCeStatusLabel(status: VoyagePodCeStatus | null | undefined) {
  if (status === 'approved') return 'Aprovado'
  if (status === 'approving') return 'Em aprovação'
  if (status === 'launching' || status === 'partial') return 'Lançando'
  if (status === 'received') return 'Recebido'
  if (status === 'missing') return 'Aguardando'
  return 'Aguardando'
}

export function deriveAutomaticVoyagePodCeStatus(ceFilledCount: number, blCount: number): VoyagePodCeStatus | null {
  if (blCount <= 0) return null
  if (ceFilledCount >= blCount) return 'approving'
  if (ceFilledCount > 0) return 'launching'
  return 'missing'
}

export function buildVoyagePolEntityId(voyageId: number, pol: string | null | undefined) {
  return `${voyageId}::${normalizePortValue(pol)}`
}

export function buildVoyagePodEntityId(voyageId: number, pod: string | null | undefined) {
  return `${voyageId}::${normalizePortValue(pod)}`
}

export async function listVoyagePolSchedules(entityIds: string[]) {
  if (!entityIds.length) return new Map<string, VoyagePolSchedule>()

  const { data, error } = await supabase
    .from('audit_logs')
    .select('entity_id, field_name, new_value, changed_at')
    .eq('entity_type', POL_ENTITY_TYPE)
    .in('entity_id', entityIds)
    .order('changed_at', { ascending: false })
    .range(0, Math.max(999, entityIds.length * 5))

  if (error) throw error

  return hydratePolSchedules(data ?? [])
}

export async function listVoyagePodSchedules(entityIds: string[]) {
  if (!entityIds.length) return new Map<string, VoyagePodSchedule>()

  const { data, error } = await supabase
    .from('audit_logs')
    .select('entity_id, field_name, new_value, changed_at')
    .eq('entity_type', POD_ENTITY_TYPE)
    .in('entity_id', entityIds)
    .order('changed_at', { ascending: false })
    .range(0, Math.max(999, entityIds.length * 20))

  if (error) throw error

  const schedules = new Map<string, VoyagePodSchedule>()
  const seenFieldsByEntity = new Map<string, Set<string>>()

  for (const row of data ?? []) {
    const entityId = row.entity_id
    const current = schedules.get(entityId) ?? makeEmptyPodSchedule(entityId)
    const seenFields = seenFieldsByEntity.get(entityId) ?? new Set<string>()

    if (row.field_name === 'eta' && !seenFields.has('eta')) current.eta = normalizeDateValue(row.new_value)
    if (row.field_name === 'etb' && !seenFields.has('etb')) current.etb = normalizeDateValue(row.new_value)
    if (row.field_name === 'ata' && !seenFields.has('ata')) current.ata = normalizeDateValue(row.new_value)
    if (row.field_name === 'atb' && !seenFields.has('atb')) current.atb = normalizeDateValue(row.new_value)
    if (row.field_name === 'etd' && !seenFields.has('etd')) current.etd = normalizeDateValue(row.new_value)
    if (row.field_name === 'atd' && !seenFields.has('atd')) current.atd = normalizeDateValue(row.new_value)
    if (row.field_name === 'rtw' && !seenFields.has('rtw')) current.rtw = normalizeNumberValue(row.new_value)
    if (row.field_name === 'ces' && !seenFields.has('ces')) current.ceStatus = normalizeCeStatusValue(row.new_value)
    if (row.field_name === 'linked' && !seenFields.has('linked')) current.linked = normalizeBooleanValue(row.new_value)
    if (row.field_name === 'escala_number' && !seenFields.has('escala_number')) current.escalaNumber = normalizeTextValue(row.new_value)
    if (row.field_name === 'deleted' && !seenFields.has('deleted')) current.deleted = normalizeBooleanValue(row.new_value) ?? false
    if (row.field_name === 'omitted' && !seenFields.has('omitted')) current.omitted = normalizeBooleanValue(row.new_value) ?? false
    if (row.field_name === 'tem_importacao' && !seenFields.has('tem_importacao')) current.temImportacao = normalizeBooleanValue(row.new_value) ?? true

    seenFields.add(row.field_name)
    seenFieldsByEntity.set(entityId, seenFields)

    schedules.set(entityId, current)
  }

  return schedules
}

export type VoyageUnifiedAtd = {
  /** ATD da escala unificada (YYYY-MM-DD), pela precedência POD-canônico/POL-fallback. */
  atd: string | null
  /** Portador cujo valor venceu a precedência — null quando nenhum dos dois tem ATD. */
  atdSource: 'pod' | 'pol' | null
  /** changed_at do audit_log do campo atd do portador vencedor: o instante do registro, não o valor. */
  atdRegisteredAt: string | null
}

// ADR 0039: T0 do Prazo de Conclusão do ADR é o ATD da escala unificada, com a
// mesma precedência POD-canônico/POL-fallback que projectVoyageEscalaSchedules
// já usa (mergeEscalaField) — reaproveitada aqui como regra ("POD vence, salvo
// vazio"), não a lógica inteira de merge/divergência, que serve a um propósito
// diferente (a projeção de várias colunas de uma vez). Consulta focada, por
// voyage+port, ao contrário de listVoyagePodSchedules/listVoyagePolSchedules
// (que trazem todos os campos de todas as entidades de uma leva).
// ponytail: ao contrário de hydratePodSchedules/projectVoyageEscalaSchedules,
// não checa o soft-delete `deleted` do POD — um POD removido do planejamento
// ainda pode vencer aqui. Upgrade: filtrar como as demais leituras fazem, se
// isso se mostrar um problema real (POD deletado raramente carrega ATD útil).
export async function getVoyageUnifiedAtd(voyageId: number, port: string): Promise<VoyageUnifiedAtd> {
  const podEntityId = buildVoyagePodEntityId(voyageId, port)
  const polEntityId = buildVoyagePolEntityId(voyageId, port)

  const [podRes, polRes] = await Promise.all([
    supabase
      .from('audit_logs')
      .select('new_value, changed_at')
      .eq('entity_type', POD_ENTITY_TYPE)
      .eq('entity_id', podEntityId)
      .eq('field_name', 'atd')
      .order('changed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('audit_logs')
      .select('new_value, changed_at')
      .eq('entity_type', POL_ENTITY_TYPE)
      .eq('entity_id', polEntityId)
      .eq('field_name', 'atd')
      .order('changed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (podRes.error) throw podRes.error
  if (polRes.error) throw polRes.error

  const podAtd = normalizeDateValue(podRes.data?.new_value ?? null)
  const polAtd = normalizeDateValue(polRes.data?.new_value ?? null)

  if (podAtd) {
    return { atd: podAtd, atdSource: 'pod', atdRegisteredAt: podRes.data?.changed_at ?? null }
  }
  if (polAtd) {
    return { atd: polAtd, atdSource: 'pol', atdRegisteredAt: polRes.data?.changed_at ?? null }
  }
  return { atd: null, atdSource: null, atdRegisteredAt: null }
}

export async function listVoyagePodSchedulesByVoyageIds(voyageIds: number[]) {
  if (!voyageIds.length) return new Map<string, VoyagePodSchedule>()

  const data = await listScheduleAuditRowsByVoyageIds(POD_ENTITY_TYPE, voyageIds)
  return hydratePodSchedules(data)
}

export async function listVoyageEscalaSchedulesByVoyageIds(voyageIds: number[]) {
  const result = new Map<number, VoyageEscalaSchedule[]>()
  if (!voyageIds.length) return result

  const [podRows, polRows, exportSchedulesByVoyage] = await Promise.all([
    listScheduleAuditRowsByVoyageIds(POD_ENTITY_TYPE, voyageIds),
    listScheduleAuditRowsByVoyageIds(POL_ENTITY_TYPE, voyageIds),
    fetchExportSchedulesByVoyageIds(voyageIds),
  ])

  const podsByVoyage = groupSchedulesByVoyage(hydratePodSchedules(podRows, { includeDeleted: true }))
  const polsByVoyage = groupSchedulesByVoyage(hydratePolSchedules(polRows))

  for (const voyageId of voyageIds) {
    result.set(voyageId, projectVoyageEscalaSchedules({
      podSchedules: podsByVoyage.get(voyageId),
      polSchedules: polsByVoyage.get(voyageId),
      exportSchedulesByPort: exportSchedulesByVoyage.get(voyageId),
    }))
  }

  return result
}

export function projectVoyageEscalaSchedules({
  podSchedules = [],
  polSchedules = [],
  exportSchedulesByPort,
}: ProjectVoyageEscalaInput) {
  const escalasByKey = new Map<string, VoyageEscalaSchedule>()
  const deletedEscalaKeys = new Set<string>()
  const podValuesByKey = new Map<string, Partial<Pick<
    VoyageEscalaSchedule,
    'eta' | 'etb' | 'etd' | 'atd' | 'ceStatus' | 'linked' | 'escalaNumber'
  >>>()

  // Coleta primeiro para que a ordem dos audit logs nao determine se um
  // alias deletado apaga ou preserva a parte de importacao da escala.
  for (const pod of podSchedules) {
    const port = normalizeBrazilianPortCode(pod.pod)
    if (port && pod.deleted) deletedEscalaKeys.add(buildEscalaKey(pod.voyageId, port))
  }

  for (const pod of podSchedules) {
    const port = normalizeBrazilianPortCode(pod.pod)
    if (!port) continue

    const key = buildEscalaKey(pod.voyageId, port)
    if (deletedEscalaKeys.has(key)) continue

    const escala = ensureEscala(escalasByKey, pod.voyageId, port)
    escala.eta = pod.eta
    escala.etb = pod.etb
    escala.ata = pod.ata
    escala.atb = pod.atb
    escala.etd = pod.etd
    escala.atd = pod.atd
    escala.rtw = pod.rtw
    escala.ceStatus = pod.ceStatus
    escala.podCeStatus = pod.ceStatus
    escala.exportCeStatus = null
    escala.linked = pod.linked
    escala.escalaNumber = pod.escalaNumber
    escala.omitted = pod.omitted ?? false
    escala.deleted = false
    // O portador fisico das datas tambem atende escalas apenas de exportacao.
    // Ausencia do marcador preserva o comportamento dos registros legados.
    escala.temImportacao = pod.temImportacao !== false
    podValuesByKey.set(key, {
      eta: pod.eta,
      etb: pod.etb,
      etd: pod.etd,
      atd: pod.atd,
      ceStatus: pod.ceStatus,
      linked: pod.linked,
      escalaNumber: pod.escalaNumber,
    })
  }

  for (const pol of polSchedules) {
    const port = normalizeBrazilianPortCode(pol.pol)
    if (!port) continue

    const key = buildEscalaKey(pol.voyageId, port)
    const escala = ensureEscala(escalasByKey, pol.voyageId, port)
    const podValues = podValuesByKey.get(key)
    // A linha de POL é registro documental (ADR 0025) e cria a escala, mas não
    // declara exportação: quem declara é o toggle da própria escala.
    mergeEscalaField(escala, 'etd', pol.etd, 'pol', podValues?.etd ?? null)
    mergeEscalaField(escala, 'atd', pol.atd, 'pol', podValues?.atd ?? null)
    mergeEscalaField(escala, 'escalaNumber', pol.escalaNumber, 'pol', podValues?.escalaNumber ?? null)
  }

  for (const [portKey, exportSchedule] of exportSchedulesByPort ?? new Map<string, VoyageExportSchedule>()) {
    const port = normalizeBrazilianPortCode(exportSchedule.pol) ?? normalizeBrazilianPortCode(portKey)
    if (!port) continue

    const key = buildEscalaKey(exportSchedule.voyageId, port)
    const escala = ensureEscala(escalasByKey, exportSchedule.voyageId, port)
    const podValues = podValuesByKey.get(key)
    // O toggle é a declaração; a linha pode existir desligada guardando o
    // próprio desligamento.
    escala.temExportacao = exportSchedule.temExportacao
    escala.exportCeStatus = exportSchedule.ceStatus
    escala.temGranito = escala.temGranito || exportSchedule.hasGranite
    escala.dischargePorts = exportSchedule.dischargePorts ?? []
    escala.containersQty = exportSchedule.containersQty
    escala.movementsQty = exportSchedule.movementsQty
    mergeEscalaField(escala, 'ceStatus', exportSchedule.ceStatus, 'export', podValues?.ceStatus ?? null)
    mergeEscalaField(escala, 'linked', exportSchedule.linked, 'export', podValues?.linked ?? null)
  }

  return Array.from(escalasByKey.values())
    .filter((escala) => !escala.deleted)
    .sort((left, right) => left.port.localeCompare(right.port, 'pt-BR'))
}

export async function saveVoyagePolSchedule({
  voyageId,
  pol,
  etd,
  atd,
  escalaNumber,
  changedBy,
  justification,
}: {
  voyageId: number
  pol: string
  etd: string | null
  atd?: string | null
  escalaNumber?: string | null
  changedBy: string | null
  justification?: string
}) {
  const entityId = buildVoyagePolEntityId(voyageId, pol)
  const current = (await listVoyagePolSchedules([entityId])).get(entityId) ?? makeEmptyPolSchedule(entityId)

  const changes = [
    atd === undefined
      ? null
      : makeAuditRow(POL_ENTITY_TYPE, entityId, 'atd', current.atd, atd, changedBy, justification ?? 'Atualizacao manual de ATD por POL'),
    makeAuditRow(POL_ENTITY_TYPE, entityId, 'etd', current.etd, etd, changedBy, 'Atualizacao manual de ETD por POL'),
    escalaNumber === undefined
      ? null
      : makeAuditRow(POL_ENTITY_TYPE, entityId, 'escala_number', current.escalaNumber, escalaNumber, changedBy, 'Atualizacao manual de Numero de Escala por POL'),
  ].filter((change) => change !== null)

  if (!changes.length) return

  const { error } = await supabase.from('audit_logs').insert(changes)
  if (error) throw error
}

export async function saveVoyagePodSchedule({
  voyageId,
  pod,
  eta,
  etb,
  ata,
  atb,
  etd,
  atd,
  rtw,
  ceStatus,
  linked,
  escalaNumber,
  temImportacao = true,
  changedBy,
}: {
  voyageId: number
  pod: string
  eta: string | null
  etb: string | null
  ata: string | null
  atb?: string | null
  etd?: string | null
  atd: string | null
  rtw: number | null
  ceStatus: VoyagePodCeStatus | null
  linked: boolean | null
  escalaNumber?: string | null
  temImportacao?: boolean
  changedBy: string | null
}) {
  const entityId = buildVoyagePodEntityId(voyageId, pod)
  const current = (await listVoyagePodSchedules([entityId])).get(entityId) ?? makeEmptyPodSchedule(entityId)

  const changes = [
    makeAuditRow(POD_ENTITY_TYPE, entityId, 'eta', current.eta, eta, changedBy, 'Atualizacao manual de ETA por POD'),
    makeAuditRow(POD_ENTITY_TYPE, entityId, 'etb', current.etb, etb, changedBy, 'Atualizacao manual de ETB por POD'),
    makeAuditRow(POD_ENTITY_TYPE, entityId, 'ata', current.ata, ata, changedBy, 'Atualizacao manual de ATA por POD'),
    atb === undefined
      ? null
      : makeAuditRow(POD_ENTITY_TYPE, entityId, 'atb', current.atb, atb, changedBy, 'Atualizacao manual de ATB por POD'),
    etd === undefined
      ? null
      : makeAuditRow(POD_ENTITY_TYPE, entityId, 'etd', current.etd, etd, changedBy, 'Atualizacao manual de ETD por POD'),
    makeAuditRow(POD_ENTITY_TYPE, entityId, 'atd', current.atd, atd, changedBy, 'Atualizacao manual de ATD por POD'),
    makeAuditRow(
      POD_ENTITY_TYPE,
      entityId,
      'rtw',
      current.rtw === null ? null : String(current.rtw),
      rtw === null ? null : String(rtw),
      changedBy,
      'Atualizacao manual de RTW por POD',
    ),
    makeAuditRow(
      POD_ENTITY_TYPE,
      entityId,
      'ces',
      current.ceStatus,
      ceStatus,
      changedBy,
      'Atualizacao manual de status de CEs por POD',
    ),
    makeAuditRow(
      POD_ENTITY_TYPE,
      entityId,
      'linked',
      current.linked === null ? null : String(current.linked),
      linked === null ? null : String(linked),
      changedBy,
      'Atualizacao manual de linked por POD',
    ),
    escalaNumber === undefined
      ? null
      : makeAuditRow(POD_ENTITY_TYPE, entityId, 'escala_number', current.escalaNumber, escalaNumber, changedBy, 'Atualizacao manual de Numero de Escala por POD'),
    makeAuditRow(
      POD_ENTITY_TYPE,
      entityId,
      'tem_importacao',
      current.temImportacao === false ? 'false' : 'true',
      temImportacao ? 'true' : 'false',
      changedBy,
      'Atualizacao manual do tipo operacional da escala',
    ),
  ].filter((change) => change !== null)

  // Reincluir um POD que havia sido removido: limpa o soft-delete.
  if (current.deleted) {
    changes.push({
      entity_type: POD_ENTITY_TYPE,
      entity_id: entityId,
      field_name: 'deleted',
      old_value: 'true',
      new_value: 'false',
      changed_by: changedBy,
      justification: 'Reinclusao de POD no planejamento',
    })
  }

  if (!changes.length) return

  const { error } = await supabase.from('audit_logs').insert(changes)
  if (error) throw error

  if (atd !== undefined) {
    await syncVoyageStatusAfterAtdChange(voyageId, pod, atd)
  }
}

export async function saveVoyageEscalaSchedule({
  voyageId,
  port,
  eta,
  etb,
  ata,
  atb,
  etd,
  atd,
  rtw,
  ceStatus,
  linked,
  escalaNumber,
  temImportacao,
  changedBy,
}: {
  voyageId: number
  port: string
  eta: string | null
  etb: string | null
  ata: string | null
  atb: string | null
  etd: string | null
  atd: string | null
  rtw: number | null
  ceStatus: VoyagePodCeStatus | null
  linked: boolean | null
  escalaNumber?: string | null
  temImportacao: boolean
  changedBy: string | null
}) {
  // ponytail: o entity_type fisico continua `voyage_pod_schedule` por compatibilidade
  // historica; upgrade = promover a escala a tabela propria como previsto na ADR 0027.
  await saveVoyagePodSchedule({
    voyageId,
    pod: normalizePortValue(port),
    eta,
    etb,
    ata,
    atb,
    etd,
    atd,
    rtw,
    ceStatus,
    linked,
    escalaNumber,
    temImportacao,
    changedBy,
  })
}

/**
 * Remove um POD do planejamento via soft-delete (audit log field `deleted`).
 * O POD some da reconstrução (Visão geral, line-up) e o evento aparece na
 * linha do tempo. Reinserir o mesmo POD limpa o marcador.
 */
export async function deleteVoyagePodSchedule({
  voyageId,
  pod,
  changedBy,
}: {
  voyageId: number
  pod: string
  changedBy: string | null
}) {
  const entityId = buildVoyagePodEntityId(voyageId, pod)
  const { error } = await supabase.from('audit_logs').insert([
    {
      entity_type: POD_ENTITY_TYPE,
      entity_id: entityId,
      field_name: 'deleted',
      old_value: 'false',
      new_value: 'true',
      changed_by: changedBy,
      justification: 'Remocao de POD do planejamento',
    },
  ])
  if (error) throw error
}

/**
 * CE Master por ROTA (POL/POD), independente de batch de manifesto (#322).
 * Viagem só-B/L não tem batch onde guardar a CE agrupadora; aqui fica por rota.
 * A chave do mapa é `${voyageId}::${POL}__${POD}` (portos em maiúsculas).
 */
export function buildVoyageRouteCeMasterKey(
  voyageId: number,
  pol: string | null | undefined,
  pod: string | null | undefined,
) {
  return `${voyageId}::${normalizeRoutePort(pol)}__${normalizeRoutePort(pod)}`
}

export async function setVoyageRouteCeMaster({
  voyageId,
  pol,
  pod,
  ceMaster,
  changedBy,
}: {
  voyageId: number
  pol: string
  pod: string
  ceMaster: string | null
  changedBy: string
}) {
  const { error } = await supabase.rpc('set_voyage_route_ce_master', {
    p_voyage_id: voyageId,
    p_pol: pol,
    p_pod: pod,
    // A função normaliza string vazia e NULL da mesma forma (NULLIF/btrim).
    p_ce_master: ceMaster ?? '',
    p_changed_by: changedBy,
  })
  if (error) throw error
}

export async function listVoyageRouteCeMasters(voyageIds: number[]) {
  const result = new Map<string, string>()
  if (!voyageIds.length) return result

  const { data, error } = await supabase
    .from('voyage_route_ce_master')
    .select('voyage_id, pol, pod, ce_master')
    .in('voyage_id', voyageIds)

  if (error) throw error

  for (const row of data ?? []) {
    const ce = normalizeTextValue(row.ce_master)
    if (!ce) continue
    result.set(buildVoyageRouteCeMasterKey(row.voyage_id, row.pol, row.pod), ce)
  }

  return result
}

/** Viagem conclui quando todo POD ativo tem ATD; POD omitido nao conta como pendente. */
export function computeVoyageStatusFromPods(
  pods: Array<{ atd: string | null; omitted?: boolean }>,
): 'active' | 'completed' {
  const relevant = pods.filter((pod) => !pod.omitted)
  if (relevant.length === 0) return 'active'
  return relevant.every((pod) => pod.atd) ? 'completed' : 'active'
}

async function syncVoyageStatusAfterAtdChange(voyageId: number, changedPod: string, newAtd: string | null) {
  const allPodSchedules = await listVoyagePodSchedulesByVoyageIds([voyageId])

  const podEntries: Array<{ atd: string | null; omitted?: boolean }> = []
  for (const [entityId, schedule] of allPodSchedules) {
    if (schedule.voyageId !== voyageId) continue
    const pod = entityId.split('::')[1] ?? '-'
    const atd = pod === changedPod ? newAtd : schedule.atd
    podEntries.push({ atd, omitted: schedule.omitted })
  }

  if (podEntries.length === 0) return

  const newStatus = computeVoyageStatusFromPods(podEntries)

  const { data: voyage, error: fetchError } = await supabase
    .from('voyages')
    .select('status')
    .eq('id', voyageId)
    .single()

  if (fetchError || !voyage || voyage.status === 'cancelled' || voyage.status === newStatus) return

  const { error: updateError } = await supabase
    .from('voyages')
    .update({ status: newStatus })
    .eq('id', voyageId)

  if (updateError) throw updateError
}

function ensureEscala(escalasByKey: Map<string, VoyageEscalaSchedule>, voyageId: number, port: string) {
  const key = buildEscalaKey(voyageId, port)
  const current = escalasByKey.get(key)
  if (current) return current

  const escala: VoyageEscalaSchedule = {
    entityId: buildVoyagePodEntityId(voyageId, port),
    voyageId,
    port,
    eta: null,
    etb: null,
    ata: null,
    atb: null,
    etd: null,
    atd: null,
    rtw: null,
    ceStatus: null,
    podCeStatus: null,
    exportCeStatus: null,
    linked: null,
    escalaNumber: null,
    omitted: false,
    deleted: false,
    temImportacao: false,
    temExportacao: false,
    temGranito: false,
    containersQty: null,
    movementsQty: null,
    dischargePorts: [],
    divergences: [],
  }
  escalasByKey.set(key, escala)
  return escala
}

function mergeEscalaField<K extends VoyageEscalaMergeField>(
  escala: VoyageEscalaSchedule,
  field: K,
  sourceValue: VoyageEscalaSchedule[K],
  source: VoyageEscalaDivergence['source'],
  podValue: VoyageEscalaSchedule[K],
) {
  if (isEmptyEscalaValue(sourceValue)) return

  if (!isEmptyEscalaValue(podValue) && podValue !== sourceValue) {
    escala.divergences.push({
      field,
      podValue: podValue as VoyageEscalaDivergence['podValue'],
      source,
      sourceValue: sourceValue as VoyageEscalaDivergence['sourceValue'],
    })
  }

  if (isEmptyEscalaValue(escala[field])) {
    escala[field] = sourceValue
  }
}

function isEmptyEscalaValue(value: string | number | boolean | null | undefined) {
  return value === null || value === undefined || value === ''
}

function buildEscalaKey(voyageId: number, port: string) {
  return `${voyageId}::${port}`
}

function normalizeBrazilianPortCode(value: string | null | undefined) {
  const normalized = normalizePortCode(value)
  return normalized && /^BR[A-Z0-9]{3}$/.test(normalized) ? normalized : null
}

function groupSchedulesByVoyage<T extends { voyageId: number }>(schedules: Map<string, T>) {
  const grouped = new Map<number, T[]>()
  for (const schedule of schedules.values()) {
    const current = grouped.get(schedule.voyageId) ?? []
    current.push(schedule)
    grouped.set(schedule.voyageId, current)
  }
  return grouped
}

async function listScheduleAuditRowsByVoyageIds(entityType: string, voyageIds: number[]) {
  const voyagePrefixes = voyageIds.map((voyageId) => `${voyageId}::`)
  const rows: Array<{
    entity_id: string
    field_name: string
    new_value: string | null
    changed_at: string | null
  }> = []

  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('entity_id, field_name, new_value, changed_at')
      .eq('entity_type', entityType)
      .order('changed_at', { ascending: false })
      .range(from, from + 999)

    if (error) throw error

    const batch = data ?? []
    rows.push(
      ...batch.filter((row) => voyagePrefixes.some((prefix) => row.entity_id.startsWith(prefix))),
    )

    if (batch.length < 1000) break
    from += 1000
  }

  return rows
}

function hydratePolSchedules(
  rows: Array<{
    entity_id: string
    field_name: string
    new_value: string | null
    changed_at?: string | null
  }>,
) {
  const schedules = new Map<string, VoyagePolSchedule>()
  const seenFieldsByEntity = new Map<string, Set<string>>()

  for (const row of rows) {
    if (row.field_name !== 'etd' && row.field_name !== 'escala_number' && row.field_name !== 'atd') continue

    const entityId = row.entity_id
    const current = schedules.get(entityId) ?? makeEmptyPolSchedule(entityId)
    const seenFields = seenFieldsByEntity.get(entityId) ?? new Set<string>()
    if (row.field_name === 'atd' && !seenFields.has('atd')) {
      current.atd = normalizeDateValue(row.new_value)
    }
    if (row.field_name === 'etd' && !seenFields.has('etd')) {
      current.etd = normalizeDateValue(row.new_value)
    }
    if (row.field_name === 'escala_number' && !seenFields.has('escala_number')) {
      current.escalaNumber = normalizeTextValue(row.new_value)
    }
    seenFields.add(row.field_name)
    seenFieldsByEntity.set(entityId, seenFields)
    schedules.set(entityId, current)
  }

  return schedules
}

function hydratePodSchedules(
  rows: Array<{
    entity_id: string
    field_name: string
    new_value: string | null
    changed_at?: string | null
  }>,
  options: { includeDeleted?: boolean } = {},
) {
  const schedules = new Map<string, VoyagePodSchedule>()
  const seenFieldsByEntity = new Map<string, Set<string>>()

  for (const row of rows) {
    const entityId = row.entity_id
    const current = schedules.get(entityId) ?? makeEmptyPodSchedule(entityId)
    const seenFields = seenFieldsByEntity.get(entityId) ?? new Set<string>()

    if (row.field_name === 'eta' && !seenFields.has('eta')) current.eta = normalizeDateValue(row.new_value)
    if (row.field_name === 'etb' && !seenFields.has('etb')) current.etb = normalizeDateValue(row.new_value)
    if (row.field_name === 'ata' && !seenFields.has('ata')) current.ata = normalizeDateValue(row.new_value)
    if (row.field_name === 'atb' && !seenFields.has('atb')) current.atb = normalizeDateValue(row.new_value)
    if (row.field_name === 'etd' && !seenFields.has('etd')) current.etd = normalizeDateValue(row.new_value)
    if (row.field_name === 'atd' && !seenFields.has('atd')) current.atd = normalizeDateValue(row.new_value)
    if (row.field_name === 'rtw' && !seenFields.has('rtw')) current.rtw = normalizeNumberValue(row.new_value)
    if (row.field_name === 'ces' && !seenFields.has('ces')) current.ceStatus = normalizeCeStatusValue(row.new_value)
    if (row.field_name === 'linked' && !seenFields.has('linked')) current.linked = normalizeBooleanValue(row.new_value)
    if (row.field_name === 'escala_number' && !seenFields.has('escala_number')) current.escalaNumber = normalizeTextValue(row.new_value)
    if (row.field_name === 'deleted' && !seenFields.has('deleted')) current.deleted = normalizeBooleanValue(row.new_value) ?? false
    if (row.field_name === 'omitted' && !seenFields.has('omitted')) current.omitted = normalizeBooleanValue(row.new_value) ?? false
    if (row.field_name === 'tem_importacao' && !seenFields.has('tem_importacao')) current.temImportacao = normalizeBooleanValue(row.new_value) ?? true

    seenFields.add(row.field_name)
    seenFieldsByEntity.set(entityId, seenFields)

    schedules.set(entityId, current)
  }

  // PODs removidos (soft-delete) somem do planejamento e dos consumidores
  // (Visão geral, line-up, status da viagem).
  if (!options.includeDeleted) {
    for (const [entityId, schedule] of schedules) {
      if (schedule.deleted) schedules.delete(entityId)
    }
  }

  return schedules
}

function makeEmptyPolSchedule(entityId: string): VoyagePolSchedule {
  const [voyageId, pol] = entityId.split('::')
  return {
    entityId,
    voyageId: Number(voyageId),
    pol: pol ?? '-',
    atd: null,
    etd: null,
    escalaNumber: null,
  }
}

function makeEmptyPodSchedule(entityId: string): VoyagePodSchedule {
  const [voyageId, pod] = entityId.split('::')
  return {
    entityId,
    voyageId: Number(voyageId),
    pod: pod ?? '-',
    temImportacao: true,
    eta: null,
    etb: null,
    ata: null,
    atb: null,
    etd: null,
    atd: null,
    rtw: null,
    ceStatus: null,
    linked: null,
    escalaNumber: null,
    deleted: false,
    omitted: false,
  }
}

function makeAuditRow(
  entityType: string,
  entityId: string,
  fieldName: 'etd' | 'eta' | 'etb' | 'ata' | 'atb' | 'atd' | 'rtw' | 'ces' | 'linked' | 'escala_number' | 'deleted' | 'tem_importacao',
  oldValue: string | null,
  newValue: string | null,
  changedBy: string | null,
  justification: string,
) {
  const normalizedOldValue = normalizeDateValue(oldValue)
  const normalizedNewValue = normalizeDateValue(newValue)

  if (normalizedOldValue === normalizedNewValue) return null

  return {
    entity_type: entityType,
    entity_id: entityId,
    field_name: fieldName,
    old_value: normalizedOldValue,
    new_value: normalizedNewValue,
    changed_by: changedBy,
    justification,
  }
}

function normalizePortValue(value: string | null | undefined) {
  return normalizePortCode(value) ?? '-'
}

function normalizeRoutePort(value: string | null | undefined) {
  return String(value ?? '').trim().toUpperCase() || '-'
}

function normalizeDateValue(value: string | null | undefined) {
  const normalized = (value ?? '').trim()
  return normalized || null
}

function normalizeTextValue(value: string | null | undefined) {
  const normalized = (value ?? '').trim()
  return normalized || null
}

function normalizeNumberValue(value: string | null | undefined) {
  const normalized = (value ?? '').trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeBooleanValue(value: string | null | undefined) {
  const normalized = (value ?? '').trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return null
}

function normalizeCeStatusValue(value: string | null | undefined): VoyagePodSchedule['ceStatus'] {
  const normalized = (value ?? '').trim().toLowerCase()
  if (
    normalized === 'waiting' ||
    normalized === 'received' ||
    normalized === 'launching' ||
    normalized === 'approving' ||
    normalized === 'approved' ||
    normalized === 'partial' ||
    normalized === 'missing'
  ) {
    return normalized
  }
  return null
}
