import { onlyDigits } from '../lib/utils'
import type { BL, BLContainer, BlFreightLine } from '../types/database'
import type { ParsedBLDocument } from './blParser'
import { supabase } from './supabase'

export type BlFreightImportDiff = {
  field: string
  from: string | number | null
  to: string | number | null
  /** true when this change touches a billing variable and needs an explicit override */
  billingImpact: boolean
}

export type BlFreightImportRow = {
  blNumber: string
  status: 'new' | 'updated' | 'unchanged' | 'blocked'
  existing: boolean
  voyageId: number | null
  consigneeDocumentMatches: boolean | null
  /** hard blocks that prevent importing the row at all (wrong file, missing voyage) */
  blockedReasons: string[]
  /** human-readable changes that affect billing; shown so the operator can decide to override */
  billingImpacts: string[]
  /** true when the row changes a billing variable on an already-billed B/L */
  requiresBillingOverride: boolean
  diffs: BlFreightImportDiff[]
  payload: BlFreightRpcPayload | null
}

export type BlFreightImportPreview = {
  rows: BlFreightImportRow[]
  summary: {
    total: number
    newCount: number
    updatedCount: number
    unchangedCount: number
    blockedCount: number
    billingOverrideCount: number
  }
}

export type BlFreightRpcPayload = {
  id: string
  voyage_id: number | null
  cargo_mode: 'container'
  shipper: string | null
  consignee: string | null
  notify_party: string | null
  pol: string | null
  pod: string | null
  place_of_delivery: string | null
  total_weight_kg: number | null
  total_cbm: number | null
  payment_type: 'PREPAID' | 'COLLECT' | null
  bl_emission_date: string | null
  manifest_customer_cnpj_cpf: string | null
  manifest_customer_name: string | null
  /** true when this B/L touches a billing variable (drives audit labeling in the RPC) */
  billing_impact: boolean
  /** authorizes applying billing-relevant physical changes (containers/vehicles/carga-solta weight) to a billed B/L */
  override_billing: boolean
  freight_lines: Array<{
    seq: number
    description: string
    category: string
    mercante_code: string | null
    currency: string | null
    amount: number | null
    payment: 'PREPAID' | 'COLLECT' | null
  }>
  containers: Array<{
    container_number: string
    seal_number: string | null
    type: string | null
    tare_weight_kg: number | null
    gross_weight_kg: number | null
    cbm: number | null
    is_oog: false
    is_imo: false
    imo_class: null
    un_number: null
  }>
  vehicles: Array<{
    chassis: string
    container_number: string | null
    brand: string
    model: string
    weight_kg: number
    cbm: number
  }>
}

type ExistingBl = Pick<
  BL,
  | 'id'
  | 'voyage_id'
  | 'cargo_mode'
  | 'shipper'
  | 'consignee'
  | 'notify_party'
  | 'pol'
  | 'pod'
  | 'place_of_delivery'
  | 'total_weight_kg'
  | 'total_cbm'
  | 'payment_type'
  | 'bl_emission_date'
  | 'manifest_customer_cnpj_cpf'
  | 'manifest_customer_name'
> & {
  bl_containers?: Pick<BLContainer, 'container_number' | 'seal_number' | 'type' | 'tare_weight_kg' | 'gross_weight_kg' | 'cbm' | 'is_imo' | 'is_oog'>[] | null
  bl_freight_lines?: Pick<BlFreightLine, 'seq' | 'description' | 'category' | 'mercante_code' | 'currency' | 'amount' | 'payment'>[] | null
}

type VoyageCandidate = {
  id: number
  voyage_number: string
  vessel?: { name?: string | null } | null
  pol?: { locode?: string | null } | null
  pod?: { locode?: string | null } | null
}

/** Billing variables recomputed per B/L; see chargeTableService application bases. */
type BillingImpact = {
  messages: string[]
  container: boolean
  weight: boolean
  cnpj: boolean
}

export type BuildBlFreightPreviewArgs = {
  documents: ParsedBLDocument[]
  existingBls?: ExistingBl[]
  billingLockedBlIds?: Set<string>
  /** container numbers that already belong to a different B/L (container_distinct_voyage billing) */
  sharedContainerNumbers?: Set<string>
  voyageIdByBl?: Map<string, number | null>
  onlyBlId?: string | null
}

export async function previewBlFreightImport(args: {
  documents: ParsedBLDocument[]
  voyageId?: number | null
  onlyBlId?: string | null
}): Promise<BlFreightImportPreview> {
  const blNumbers = args.documents.map((doc) => doc.blNumber).filter(Boolean)
  const existingBls = await fetchExistingBls(blNumbers)
  const existingIds = new Set(existingBls.map((bl) => bl.id))
  const billingLockedBlIds = await fetchBillingLockedBlIds([...existingIds])
  const containerNumbers = args.documents.flatMap((doc) => doc.containers.map((container) => container.containerNumber))
  const sharedContainerNumbers = await fetchSharedContainerNumbers(blNumbers, containerNumbers)
  const voyageIdByBl = new Map<string, number | null>()

  for (const doc of args.documents) {
    if (args.voyageId) {
      voyageIdByBl.set(doc.blNumber, args.voyageId)
      continue
    }
    const existing = existingBls.find((bl) => bl.id === doc.blNumber)
    voyageIdByBl.set(doc.blNumber, existing?.voyage_id ?? await resolveVoyageId(doc))
  }

  return buildBlFreightPreview({
    documents: args.documents,
    existingBls,
    billingLockedBlIds,
    sharedContainerNumbers,
    voyageIdByBl,
    onlyBlId: args.onlyBlId,
  })
}

export function buildBlFreightPreview({
  documents,
  existingBls = [],
  billingLockedBlIds = new Set(),
  sharedContainerNumbers = new Set(),
  voyageIdByBl = new Map(),
  onlyBlId = null,
}: BuildBlFreightPreviewArgs): BlFreightImportPreview {
  const existingById = new Map(existingBls.map((bl) => [bl.id, bl]))
  const rows = documents.map((doc) => {
    const existing = existingById.get(doc.blNumber) ?? null
    const voyageId = voyageIdByBl.get(doc.blNumber) ?? existing?.voyage_id ?? null
    const payload = buildBlFreightPayload(doc, voyageId)
    const blockedReasons: string[] = []

    if (onlyBlId && doc.blNumber !== onlyBlId) {
      blockedReasons.push(`Arquivo contem B/L ${doc.blNumber}, mas a ficha aberta e ${onlyBlId}.`)
    }
    if (!voyageId) {
      blockedReasons.push('Viagem nao encontrada para criar o B/L.')
    }

    const consigneeDocumentMatches = existing?.manifest_customer_cnpj_cpf
      ? onlyDigits(existing.manifest_customer_cnpj_cpf) === onlyDigits(payload.manifest_customer_cnpj_cpf)
      : null

    const billed = billingLockedBlIds.has(doc.blNumber)
    const impact = existing && billed
      ? computeBillingImpact(existing, payload, sharedContainerNumbers)
      : { messages: [], container: false, weight: false, cnpj: false }
    const requiresBillingOverride = impact.messages.length > 0

    const diffs = existing ? diffExistingBl(existing, payload, impact) : []
    // Only the operator's override decision is pending; a billing impact never nulls the payload.
    payload.billing_impact = requiresBillingOverride
    payload.override_billing = !requiresBillingOverride

    const status: BlFreightImportRow['status'] = blockedReasons.length
      ? 'blocked'
      : !existing
        ? 'new'
        : diffs.length
          ? 'updated'
          : 'unchanged'

    return {
      blNumber: doc.blNumber,
      status,
      existing: Boolean(existing),
      voyageId,
      consigneeDocumentMatches,
      blockedReasons,
      billingImpacts: impact.messages,
      requiresBillingOverride,
      diffs,
      payload: blockedReasons.length ? null : payload,
    }
  })

  return {
    rows,
    summary: {
      total: rows.length,
      newCount: rows.filter((row) => row.status === 'new').length,
      updatedCount: rows.filter((row) => row.status === 'updated').length,
      unchangedCount: rows.filter((row) => row.status === 'unchanged').length,
      blockedCount: rows.filter((row) => row.status === 'blocked').length,
      billingOverrideCount: rows.filter((row) => row.requiresBillingOverride).length,
    },
  }
}

export async function confirmBlFreightImport(
  preview: BlFreightImportPreview,
  changedBy: string,
  overrideBilling = false,
) {
  const payload = preview.rows.flatMap((row) => {
    if (!row.payload) return []
    // Rows that touch a billing variable only apply the physical change when the operator overrode.
    return [row.requiresBillingOverride ? { ...row.payload, override_billing: overrideBilling } : row.payload]
  })
  if (!payload.length) {
    throw new Error('Nenhum B/L liberado para importar.')
  }

  const { data, error } = await supabase.rpc('import_bl_freight_transactional', {
    p_bls: payload,
    p_changed_by: changedBy,
  })
  if (error) throw error
  return data
}

export function buildBlFreightPayload(doc: ParsedBLDocument, voyageId: number | null): BlFreightRpcPayload {
  const containers = doc.containers.map((container) => ({
    container_number: container.containerNumber,
    seal_number: container.sealNumber,
    type: container.type,
    tare_weight_kg: container.tareKg,
    gross_weight_kg: container.grossWeightKg,
    cbm: container.cbm,
    is_oog: false as const,
    is_imo: false as const,
    imo_class: null,
    un_number: null,
  }))
  const oceanFreight = doc.freightCharges.find((line) => normalizeFreightCategory(line.description) === 'OCEAN_FREIGHT')

  return {
    id: doc.blNumber,
    voyage_id: voyageId,
    cargo_mode: 'container',
    shipper: doc.parties.shipperBlock || null,
    consignee: firstLine(doc.parties.consigneeBlock),
    notify_party: doc.parties.notifyBlock || null,
    pol: doc.route.pol || null,
    pod: doc.route.pod || null,
    place_of_delivery: doc.route.delivery || null,
    total_weight_kg: sumNumbers(containers.map((container) => container.gross_weight_kg)),
    total_cbm: sumNumbers(containers.map((container) => container.cbm)),
    payment_type: oceanFreight?.payment ?? null,
    bl_emission_date: normalizeDate(doc.dates.issueDate || doc.dates.ladenOnBoard),
    manifest_customer_cnpj_cpf: doc.parties.consigneeTaxId,
    manifest_customer_name: firstLine(doc.parties.consigneeBlock),
    billing_impact: false,
    override_billing: true,
    freight_lines: doc.freightCharges.map((charge, index) => ({
      seq: index + 1,
      description: charge.description,
      category: normalizeFreightCategory(charge.description),
      mercante_code: null,
      currency: charge.currency,
      amount: charge.amount,
      payment: charge.payment,
    })),
    containers,
    vehicles: doc.vehicles.map((vehicle) => ({
      chassis: vehicle.chassis,
      container_number: vehicle.containerNumber,
      brand: 'NA',
      model: 'NA',
      weight_kg: 0,
      cbm: 0,
    })),
  }
}

// Billing variables (chargeTableService): container count/TEU, shared containers
// (container_distinct_voyage), IMO/OOG profile, weight for carga_solta, and the
// billed CNPJ. Everything else is freely correctable.
// ponytail: granito cargo is billed through its own weight-based workflow; if it
// starts flowing through this import, add cargo_mode 'granito' to the weight gate.
function computeBillingImpact(
  existing: ExistingBl,
  payload: BlFreightRpcPayload,
  sharedContainerNumbers: Set<string>,
): BillingImpact {
  const messages: string[] = []
  const existingContainers = existing.bl_containers ?? []

  const existingCount = existingContainers.length
  const nextCount = payload.containers.length
  const countChanged = existingCount !== nextCount
  if (countChanged) {
    messages.push(`Quantidade de containers: ${existingCount} -> ${nextCount}`)
  }

  const shared = payload.containers
    .map((container) => container.container_number)
    .filter((number) => sharedContainerNumbers.has(number))
  if (shared.length) {
    messages.push(`Container(s) tambem vinculados a outro B/L: ${shared.join(', ')}`)
  }

  const existingImoOog = existingContainers.some((container) => container.is_imo || container.is_oog)
  const nextImoOog = payload.containers.some((container) => container.is_imo || container.is_oog)
  const imoOogChanged = existingImoOog !== nextImoOog
  if (imoOogChanged) {
    messages.push('Perfil IMO/OOG dos containers muda')
  }

  const isBreakBulk = existing.cargo_mode === 'carga_solta'
  const weightChanged = normalizeComparable(existing.total_weight_kg) !== normalizeComparable(payload.total_weight_kg)
  const weight = isBreakBulk && weightChanged
  if (weight) {
    messages.push(`Peso (carga solta, variavel de faturamento): ${existing.total_weight_kg ?? '-'} -> ${payload.total_weight_kg ?? '-'}`)
  }

  const existingDoc = onlyDigits(existing.manifest_customer_cnpj_cpf ?? '')
  const nextDoc = onlyDigits(payload.manifest_customer_cnpj_cpf ?? '')
  const cnpj = Boolean(existingDoc) && Boolean(nextDoc) && existingDoc !== nextDoc
  if (cnpj) {
    messages.push(`CNPJ faturado: ${existing.manifest_customer_cnpj_cpf} -> ${payload.manifest_customer_cnpj_cpf}`)
  }

  return { messages, container: countChanged || shared.length > 0 || imoOogChanged, weight, cnpj }
}

function diffExistingBl(existing: ExistingBl, payload: BlFreightRpcPayload, impact: BillingImpact): BlFreightImportDiff[] {
  const diffs: BlFreightImportDiff[] = []
  addDiff(diffs, 'shipper', existing.shipper, payload.shipper, false)
  addDiff(diffs, 'consignee', existing.consignee, payload.consignee, false)
  addDiff(diffs, 'notify_party', existing.notify_party, payload.notify_party, false)
  addDiff(diffs, 'pol', existing.pol, payload.pol, false)
  addDiff(diffs, 'pod', existing.pod, payload.pod, false)
  addDiff(diffs, 'place_of_delivery', existing.place_of_delivery, payload.place_of_delivery, false)
  addDiff(diffs, 'payment_type', existing.payment_type, payload.payment_type, false)
  addDiff(diffs, 'bl_emission_date', existing.bl_emission_date, payload.bl_emission_date, false)
  addDiff(diffs, 'manifest_customer_cnpj_cpf', existing.manifest_customer_cnpj_cpf, payload.manifest_customer_cnpj_cpf, impact.cnpj)
  addDiff(diffs, 'manifest_customer_name', existing.manifest_customer_name, payload.manifest_customer_name, false)
  addDiff(diffs, 'total_weight_kg', existing.total_weight_kg, payload.total_weight_kg, impact.weight)
  addDiff(diffs, 'total_cbm', existing.total_cbm, payload.total_cbm, false)

  const existingContainers = normalizeContainerSet(existing.bl_containers ?? [])
  const nextContainers = normalizeContainerSet(payload.containers)
  addDiff(diffs, 'containers', existingContainers, nextContainers, impact.container)

  const existingFreight = normalizeFreightSet(existing.bl_freight_lines ?? [])
  const nextFreight = normalizeFreightSet(payload.freight_lines)
  addDiff(diffs, 'bl_freight_lines', existingFreight, nextFreight, false)

  return diffs
}

function addDiff(
  diffs: BlFreightImportDiff[],
  field: string,
  from: string | number | null | undefined,
  to: string | number | null | undefined,
  billingImpact: boolean,
) {
  const left = normalizeComparable(from)
  const right = normalizeComparable(to)
  if (left === right) return
  diffs.push({ field, from: from ?? null, to: to ?? null, billingImpact })
}

async function fetchExistingBls(blNumbers: string[]): Promise<ExistingBl[]> {
  if (!blNumbers.length) return []
  const { data, error } = await supabase
    .from('bls')
    .select(`
      id, voyage_id, cargo_mode, shipper, consignee, notify_party, pol, pod, place_of_delivery,
      total_weight_kg, total_cbm, payment_type, bl_emission_date,
      manifest_customer_cnpj_cpf, manifest_customer_name,
      bl_containers(container_number, seal_number, type, tare_weight_kg, gross_weight_kg, cbm, is_imo, is_oog),
      bl_freight_lines(seq, description, category, mercante_code, currency, amount, payment)
    `)
    .in('id', blNumbers)
  if (error) throw error
  return (data ?? []) as unknown as ExistingBl[]
}

async function fetchBillingLockedBlIds(blNumbers: string[]) {
  if (!blNumbers.length) return new Set<string>()
  const [charges, invoices] = await Promise.all([
    supabase.from('charge_calculations').select('bl_id').in('bl_id', blNumbers),
    supabase.from('invoice_bls').select('bl_id').in('bl_id', blNumbers),
  ])
  if (charges.error) throw charges.error
  if (invoices.error) throw invoices.error
  return new Set([
    ...((charges.data ?? []) as Array<{ bl_id: string | null }>).map((row) => row.bl_id).filter(Boolean),
    ...((invoices.data ?? []) as Array<{ bl_id: string | null }>).map((row) => row.bl_id).filter(Boolean),
  ] as string[])
}

async function fetchSharedContainerNumbers(blNumbers: string[], containerNumbers: string[]) {
  const numbers = [...new Set(containerNumbers.filter(Boolean))]
  if (!numbers.length) return new Set<string>()
  const { data, error } = await supabase
    .from('bl_containers')
    .select('container_number, bl_id')
    .in('container_number', numbers)
  if (error) throw error
  const importSet = new Set(blNumbers)
  return new Set(
    ((data ?? []) as Array<{ container_number: string | null; bl_id: string | null }>)
      .filter((row) => row.container_number && row.bl_id && !importSet.has(row.bl_id))
      .map((row) => row.container_number as string),
  )
}

async function resolveVoyageId(doc: ParsedBLDocument): Promise<number | null> {
  if (!doc.route.voyage) return null
  const { data, error } = await supabase
    .from('voyages')
    .select('id, voyage_number, vessel:vessels(name), pol:ports!voyages_pol_id_fkey(locode), pod:ports!voyages_pod_id_fkey(locode)')
    .eq('voyage_number', doc.route.voyage)
    .limit(20)
  if (error) throw error

  const candidates = (data ?? []) as unknown as VoyageCandidate[]
  const normalizedVessel = normalizeText(doc.route.vessel)
  const normalizedPol = normalizeText(doc.route.pol)
  const normalizedPod = normalizeText(doc.route.pod)
  // Require the vessel to match; a shared voyage_number across vessels must not
  // silently attach the B/L to the first candidate.
  return candidates.find((voyage) => (
    normalizeText(voyage.vessel?.name) === normalizedVessel
    && (!normalizedPol || normalizeText(voyage.pol?.locode) === normalizedPol)
    && (!normalizedPod || normalizeText(voyage.pod?.locode) === normalizedPod)
  ))?.id ?? null
}

function normalizeFreightCategory(value: string) {
  return value.toUpperCase().trim().replace(/[\s-]+/g, '_')
}

function firstLine(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null
}

function normalizeDate(value: string) {
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length >= 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
  return null
}

function sumNumbers(values: Array<number | null>) {
  const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (!numbers.length) return null
  return numbers.reduce((sum, value) => sum + value, 0)
}

function normalizeComparable(value: string | number | null | undefined) {
  if (typeof value === 'number') return String(Math.round(value * 1000) / 1000)
  return String(value ?? '').trim()
}

function normalizeContainerSet(containers: Array<Partial<BLContainer> | BlFreightRpcPayload['containers'][number]>) {
  return containers
    .map((container) => [
      container.container_number,
      container.seal_number ?? '',
      container.type ?? '',
      normalizeComparable(container.tare_weight_kg),
      normalizeComparable(container.gross_weight_kg),
      normalizeComparable(container.cbm),
    ].join('|'))
    .sort()
    .join(';')
}

function normalizeFreightSet(lines: Array<Partial<BlFreightLine> | BlFreightRpcPayload['freight_lines'][number]>) {
  return lines
    .map((line) => [
      line.seq,
      line.description ?? '',
      line.category ?? '',
      line.mercante_code ?? '',
      line.currency ?? '',
      normalizeComparable(line.amount),
      line.payment ?? '',
    ].join('|'))
    .sort()
    .join(';')
}

function normalizeText(value?: string | null) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
}
