import { describe, expect, it } from 'vitest'
import { canonicalizeVesselName, normalizeVesselImo } from '../vesselAlias'

describe('vesselAlias S03', () => {
  it('normaliza o rótulo do IMO sem converter o identificador em número', () => {
    expect(normalizeVesselImo(' IMO: 1234567 ')).toBe('1234567')
    expect(normalizeVesselImo('')).toBeNull()
  })

  it('CSCL não é prefixo de CS', () => {
    expect(canonicalizeVesselName('CSCL VENUS')).toBe('CSCL VENUS')
    expect(canonicalizeVesselName('CSCL-VENUS')).toBe('CSCL VENUS')
  })

  it('pontuação e caixa variadas ainda expandem', () => {
    expect(canonicalizeVesselName('CS-ALGOL')).toBe('COSCO SHIPPING ALGOL')
    expect(canonicalizeVesselName('C.S.-ALGOL')).toBe('COSCO SHIPPING ALGOL')
    expect(canonicalizeVesselName('zyhy-jin qu')).toBe('ZHONG YUAN HAI YUN JIN QU')
  })

  it('aceita abreviações pontuadas e designação M/V sem ampliar o prefixo', () => {
    expect(canonicalizeVesselName('C.S ALGOL')).toBe('COSCO SHIPPING ALGOL')
    expect(canonicalizeVesselName('CS. ALGOL')).toBe('COSCO SHIPPING ALGOL')
    expect(canonicalizeVesselName('C S ALGOL')).toBe('COSCO SHIPPING ALGOL')
    expect(canonicalizeVesselName('M/V ZYHY JIN QU')).toBe('ZHONG YUAN HAI YUN JIN QU')
    expect(canonicalizeVesselName('VSL ZYHY JIN QU')).toBe('ZHONG YUAN HAI YUN JIN QU')
    expect(canonicalizeVesselName('VESSEL ZYHY JIN QU')).toBe('ZHONG YUAN HAI YUN JIN QU')
    expect(canonicalizeVesselName('CSCL ALGOL')).toBe('CSCL ALGOL')
  })
})
