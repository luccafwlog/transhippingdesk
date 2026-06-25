import { describe, expect, it } from 'vitest'

import { buildDemurrageRateUpsertPayload } from '../demurrageRatesHelpers'

// DEF-003: criar uma tarifa de demurrage sem informar "Válido de" enviava
// valid_from=null explícito e violava o NOT NULL (23502) do banco, em vez de
// deixar o default (data de hoje) aplicar. O helper omite a chave nesse caso.
describe('buildDemurrageRateUpsertPayload', () => {
  it('omite valid_from nulo (deixa o default do banco aplicar)', () => {
    const out = buildDemurrageRateUpsertPayload({ container_type: 'QA1', valid_from: null, valid_to: null, p1_usd: 40 })
    expect('valid_from' in out).toBe(false)
    expect(out).toEqual({ container_type: 'QA1', valid_to: null, p1_usd: 40 })
  })

  it('omite valid_from undefined', () => {
    const out = buildDemurrageRateUpsertPayload({ container_type: 'QA1' })
    expect('valid_from' in out).toBe(false)
  })

  it('preserva valid_from quando informado', () => {
    const out = buildDemurrageRateUpsertPayload({ container_type: 'QA1', valid_from: '2026-06-25', valid_to: null })
    expect(out.valid_from).toBe('2026-06-25')
  })
})
