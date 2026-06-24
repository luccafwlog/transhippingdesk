import type { BlTimelineEvent, BlTimelineFamily } from '../../services/blTimeline'

const FAMILY_LABEL: Record<BlTimelineFamily, string> = {
  edicao: 'Edição',
  container: 'Container',
  taxas: 'Taxas',
  fatura: 'Fatura',
  sistema: 'Sistema',
}

const FAMILY_TONE: Record<BlTimelineFamily, 'blue' | 'slate' | 'green' | 'yellow' | 'red'> = {
  edicao: 'blue',
  container: 'slate',
  taxas: 'green',
  fatura: 'yellow',
  sistema: 'red',
}

export function familyLabel(family: BlTimelineFamily): string {
  return FAMILY_LABEL[family]
}

export function familyTone(family: BlTimelineFamily) {
  return FAMILY_TONE[family]
}

export function describeTimelineEvent(event: BlTimelineEvent): string {
  const { entity_type, field_name, old_value, new_value } = event
  if (entity_type === 'invoice') {
    if (new_value && /^INV-/i.test(new_value)) return `Fatura ${new_value}`
    if (new_value === 'issued') return 'Fatura emitida'
    if (new_value === 'paid') return 'Fatura paga'
    return `Fatura: ${field_name}`
  }
  if (entity_type === 'charge_calculation') {
    return `Taxa: ${new_value ?? field_name}`
  }
  if (entity_type === 'bl_container') {
    return `Container ${field_name}: ${old_value ?? '-'} → ${new_value ?? '-'}`
  }
  if (entity_type === 'system_event') {
    return new_value ?? field_name
  }
  // entity_type === 'bl' (field edits, incl. charge_status/financial_status)
  return `${field_name}: ${old_value ?? '-'} → ${new_value ?? '-'}`
}

// Auditoria = entrada com justificativa deliberada (ver CONTEXT.md).
export function isAudited(event: BlTimelineEvent): boolean {
  return Boolean(event.justification && event.justification.trim())
}
