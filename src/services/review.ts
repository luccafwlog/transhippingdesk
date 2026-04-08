import { supabase } from './supabase'
import type { BL } from '../types/database'

type ReviewEditableFields = Pick<BL, 'shipper' | 'consignee' | 'pol' | 'pod' | 'total_weight_kg' | 'total_cbm' | 'notes'>

export async function saveBlReview({
  blId,
  original,
  values,
  customerId,
  previousCustomerId,
  changedBy,
  justification,
}: {
  blId: string
  original: ReviewEditableFields
  values: ReviewEditableFields
  customerId: number | null
  previousCustomerId: number | null
  changedBy: string
  justification: string
}) {
  const changedEntries = Object.entries(values).filter(
    ([field, value]) => stringifyValue(original[field as keyof ReviewEditableFields]) !== stringifyValue(value),
  ) as Array<[keyof ReviewEditableFields, ReviewEditableFields[keyof ReviewEditableFields]]>

  const customerChanged = previousCustomerId !== customerId

  const updatePayload: Partial<BL> = {
    review_status: 'reviewed',
  }

  changedEntries.forEach(([field, value]) => {
    updatePayload[field] = normalizeBlValue(field, value) as never
  })

  if (customerChanged) {
    updatePayload.customer_id = customerId
  }

  const { error: updateError } = await supabase.from('bls').update(updatePayload).eq('id', blId)
  if (updateError) throw updateError

  const auditRows = [
    ...changedEntries.map(([field, value]) => ({
      entity_type: 'bl',
      entity_id: blId,
      field_name: field,
      old_value: stringifyValue(original[field]),
      new_value: stringifyValue(value),
      changed_by: changedBy,
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
            changed_by: changedBy,
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
      changed_by: changedBy,
      justification,
    },
  ]

  const { error: auditError } = await supabase.from('audit_logs').insert(auditRows)
  if (auditError) throw auditError
}

function normalizeBlValue(field: keyof ReviewEditableFields, value: unknown) {
  if (field === 'total_weight_kg' || field === 'total_cbm') {
    return value === '' || value === null || value === undefined ? null : Number(value)
  }

  return value === '' ? null : value
}

function stringifyValue(value: unknown) {
  return value === null || value === undefined ? '' : String(value)
}
