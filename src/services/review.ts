import { supabase } from './supabase'
import type { BL } from '../types/database'

type ReviewEditableFields = Pick<BL, 'shipper' | 'consignee' | 'pol' | 'pod' | 'total_weight_kg' | 'total_cbm' | 'notes'>

/**
 * Estado recomputado pelo gate ao salvar uma revisao. `pendencias` lista os
 * bloqueios que ainda impedem o B/L de sair da fila; quando vazio, o RPC ja
 * marcou o B/L como `reviewed`. A UI usa isso para decidir, sem adivinhar, se
 * remove a linha/fecha o painel ou apenas reduz as pendencias exibidas.
 */
export type SaveBlReviewResult = {
  updatedAt: string | null
  reviewStatus: BL['review_status']
  pendencias: string[]
  resolved: boolean
}

function parseSaveBlReviewResult(data: unknown): SaveBlReviewResult {
  const row = (data ?? {}) as {
    updated_at?: string | null
    review_status?: BL['review_status']
    pendencias?: unknown
  }
  const pendencias = Array.isArray(row.pendencias) ? row.pendencias.map(String) : []
  return {
    updatedAt: row.updated_at ?? null,
    reviewStatus: row.review_status ?? null,
    pendencias,
    resolved: row.review_status === 'reviewed' && pendencias.length === 0,
  }
}

/**
 * Salva a revisao de um B/L usando a RPC `save_bl_review`.
 *
 * A RPC aplica o UPDATE e os INSERTs de audit_log em uma unica
 * transacao PL/pgSQL, e faz optimistic lock comparando `updated_at`
 * com o valor que o cliente leu (`expectedUpdatedAt`). Se outro
 * usuario alterou o B/L entre o load e o save, a funcao levanta
 * SQLSTATE PT409 (ou 40001 para retrocompatibilidade) e o chamador
 * recebe o erro de conflito concorrente.
 */
export async function saveBlReview({
  blId,
  original,
  values,
  customerId,
  previousCustomerId,
  changedBy,
  justification,
  expectedUpdatedAt,
}: {
  blId: string
  original: ReviewEditableFields
  values: ReviewEditableFields
  customerId: number | null
  previousCustomerId: number | null
  changedBy: string
  justification: string
  expectedUpdatedAt: string | null
}) {
  const changedEntries = Object.entries(values).filter(
    ([field, value]) => stringifyValue(original[field as keyof ReviewEditableFields]) !== stringifyValue(value),
  ) as Array<[keyof ReviewEditableFields, ReviewEditableFields[keyof ReviewEditableFields]]>

  const customerChanged = previousCustomerId !== customerId

  const updatePayload: Record<string, unknown> = {}

  for (const [field, value] of changedEntries) {
    const normalized = normalizeBlValue(field, value)
    if (normalized instanceof InvalidNumericValue) {
      throw new Error(`Valor invalido para ${String(field)}: informe um numero valido.`)
    }
    updatePayload[field] = normalized
  }

  if (customerChanged) {
    updatePayload.customer_id = customerId
  }

  const auditRows = [
    ...changedEntries.map(([field, value]) => ({
      entity_type: 'bl',
      entity_id: blId,
      field_name: field,
      old_value: stringifyValue(original[field]),
      new_value: stringifyValue(value),
      justification,
    })),
    ...(customerChanged
      ? [
          {
            entity_type: 'bl',
            entity_id: blId,
            field_name: 'customer_id',
            old_value: stringifyValue(previousCustomerId),
            new_value: stringifyValue(customerId),
            justification,
          },
        ]
      : []),
  ]

  const { data, error } = await supabase.rpc('save_bl_review', {
    p_bl_id: blId,
    p_expected_updated_at: expectedUpdatedAt,
    p_update_payload: updatePayload,
    p_audit_rows: auditRows,
    p_changed_by: changedBy,
  })

  if (error) {
    if (error.code === 'PT409' || error.code === '40001') {
      throw new ConcurrentEditError(error.message)
    }
    throw error
  }

  return parseSaveBlReviewResult(data)
}

/**
 * Aplica uma correcao pontual (inline) na fila de revisao reaproveitando a RPC
 * `save_bl_review`: atualiza um unico campo e grava o audit_log na mesma
 * transacao com optimistic lock. O banco recomputa e audita `review_status`.
 * Usada pelas acoes inline de /revisao (vincular cliente, CE Mercante, peso BB)
 * sem abrir o modal.
 */
export async function applyInlineBlReviewFix({
  blId,
  field,
  value,
  previousValue,
  changedBy,
  expectedUpdatedAt,
}: {
  blId: string
  field: 'customer_id' | 'ce_mercante' | 'bb_weight_ton'
  value: string | number | null
  previousValue: string | number | null
  changedBy: string
  expectedUpdatedAt: string | null
}) {
  const justification = 'Correcao inline na fila de revisao'
  const updatePayload: Record<string, unknown> = {
    [field]: value,
  }

  const auditRows = [
    {
      entity_type: 'bl',
      entity_id: blId,
      field_name: field,
      old_value: stringifyValue(previousValue),
      new_value: stringifyValue(value),
      justification,
    },
  ]

  const { data, error } = await supabase.rpc('save_bl_review', {
    p_bl_id: blId,
    p_expected_updated_at: expectedUpdatedAt,
    p_update_payload: updatePayload,
    p_audit_rows: auditRows,
    p_changed_by: changedBy,
  })

  if (error) {
    if (error.code === 'PT409' || error.code === '40001') {
      throw new ConcurrentEditError(error.message)
    }
    throw error
  }

  return parseSaveBlReviewResult(data)
}

/**
 * Reavalia o gate de um B/L sem alterar campos. Usado apos uma correcao de
 * nivel-cliente (e-mail adicionado, portal provisionado) refletir em todos os
 * B/Ls daquele cliente: o `save_bl_review` recomputa `review_status` pela funcao
 * canonica mesmo com payload vazio. Sem linhas de auditoria (nada mudou no B/L).
 */
export async function recomputeBlReviewGate({
  blId,
  expectedUpdatedAt,
  changedBy,
}: {
  blId: string
  expectedUpdatedAt: string | null
  changedBy: string
}): Promise<SaveBlReviewResult> {
  const { data, error } = await supabase.rpc('save_bl_review', {
    p_bl_id: blId,
    p_expected_updated_at: expectedUpdatedAt,
    p_update_payload: {},
    p_audit_rows: [],
    p_changed_by: changedBy,
  })

  if (error) {
    if (error.code === 'PT409' || error.code === '40001') {
      throw new ConcurrentEditError(error.message)
    }
    throw error
  }

  return parseSaveBlReviewResult(data)
}

export async function saveGraniteBlReview({
  graniteBlId,
  clientId,
  changedBy,
}: {
  graniteBlId: string
  clientId: number
  changedBy: string
}): Promise<void> {
  const { error } = await supabase.rpc('save_granite_bl_review', {
    p_granite_bl_id: graniteBlId,
    p_client_id: clientId,
    p_changed_by: changedBy,
  })
  if (error) throw error
}

export class ConcurrentEditError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConcurrentEditError'
  }
}

class InvalidNumericValue {}

function normalizeBlValue(field: keyof ReviewEditableFields, value: unknown): unknown {
  if (field === 'total_weight_kg' || field === 'total_cbm') {
    if (value === '' || value === null || value === undefined) return null
    const parsed = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(parsed)) return new InvalidNumericValue()
    return parsed
  }

  return value === '' ? null : value
}

function stringifyValue(value: unknown) {
  return value === null || value === undefined ? '' : String(value)
}
