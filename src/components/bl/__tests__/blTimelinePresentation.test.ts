import { describe, expect, it } from 'vitest'
import { describeTimelineEvent, familyLabel, isAudited } from '../blTimelinePresentation'

describe('describeTimelineEvent', () => {
  it('humanizes a field edit', () => {
    const e = { family: 'edicao', entity_type: 'bl', field_name: 'notify_party', old_value: 'X', new_value: 'Y', justification: 'ajuste' } as never
    expect(describeTimelineEvent(e)).toBe('notify_party: X → Y')
  })
  it('humanizes an invoice event', () => {
    const e = { family: 'fatura', entity_type: 'invoice', field_name: 'create_invoice', old_value: null, new_value: 'INV-2026-0103', justification: null } as never
    expect(describeTimelineEvent(e)).toMatch(/Fatura/i)
  })
  it('maps family labels', () => {
    expect(familyLabel('taxas')).toBe('Taxas')
  })
  it('flags audited entries (with justification)', () => {
    expect(isAudited({ justification: 'motivo' } as never)).toBe(true)
    expect(isAudited({ justification: null } as never)).toBe(false)
  })
})
