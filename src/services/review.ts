import { supabase } from './supabase'
import type { BL } from '../types/database'

type ReviewEditableFields = Pick<BL, 'shipper' | 'consignee' | 'pol' | 'pod' | 'total_weight_kg' | 'total_cbm' | 'notes'>

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

  const updatePayload: Record<string, unknown> = {
    review_status: 'reviewed',
  }

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
    {
      entity_type: 'bl',
      entity_id: blId,
      field_name: 'review_status',
      old_value: 'pending_review',
      new_value: 'reviewed',
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
    if (error.code === '40001') {
      throw new ConcurrentEditError(error.message)
    }
    throw error
  }

  return (data as string) ?? null
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
