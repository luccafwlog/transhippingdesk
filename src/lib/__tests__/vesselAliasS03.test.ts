import { describe, expect, it } from 'vitest'
import { canonicalizeVesselName } from '../vesselAlias'

describe('vesselAlias S03', () => {
  it('CSCL não é prefixo de CS', () => {
    expect(canonicalizeVesselName('CSCL VENUS')).toBe('CSCL VENUS')
    expect(canonicalizeVesselName('CSCL-VENUS')).toBe('CSCL VENUS')
  })

  it('pontuação e caixa variadas ainda expandem', () => {
    expect(canonicalizeVesselName('CS-ALGOL')).toBe('COSCO SHIPPING ALGOL')
    expect(canonicalizeVesselName('C.S.-ALGOL')).toBe('COSCO SHIPPING ALGOL')
    expect(canonicalizeVesselName('zyhy-jin qu')).toBe('ZHONG YUAN HAI YUN JIN QU')
  })
})
