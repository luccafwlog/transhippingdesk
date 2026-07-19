import { describe, expect, it } from 'vitest'
import { BL_EDITABLE_FIELDS } from '../useBlEditForm'

describe('BL_EDITABLE_FIELDS', () => {
  it('inclui os campos documentais da replica', () => {
    for (const field of ['place_of_receipt', 'movement_from', 'movement_to', 'issue_place', 'place_of_delivery', 'bl_emission_date']) {
      expect(BL_EDITABLE_FIELDS).toContain(field)
    }
  })
})
