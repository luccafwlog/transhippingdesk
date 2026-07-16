import { describe, expect, it } from 'vitest'
import { canonicalizeVesselName } from '../vesselAlias'

describe('canonicalizeVesselName', () => {
  it('expande ZYHY como prefixo completo', () => {
    expect(canonicalizeVesselName('ZYHY JIN QU')).toBe('ZHONG YUAN HAI YUN JIN QU')
  })

  it('expande CS e C.S. como prefixo completo', () => {
    expect(canonicalizeVesselName('CS ALGOL')).toBe('COSCO SHIPPING ALGOL')
    expect(canonicalizeVesselName('C.S. ALGOL')).toBe('COSCO SHIPPING ALGOL')
  })

  it('e idempotente sobre a forma canonica', () => {
    expect(canonicalizeVesselName('ZHONG YUAN HAI YUN JIN QU')).toBe('ZHONG YUAN HAI YUN JIN QU')
    expect(canonicalizeVesselName('COSCO SHIPPING ALGOL')).toBe('COSCO SHIPPING ALGOL')
  })

  it('nao expande alias concatenado ou no meio do nome', () => {
    expect(canonicalizeVesselName('CSALGOL')).toBe('CSALGOL')
    expect(canonicalizeVesselName('NAVIO CS ALGOL')).toBe('NAVIO CS ALGOL')
  })

  it('normaliza caixa, acentos e espacos antes de comparar', () => {
    expect(canonicalizeVesselName('  zyhy jin qu ')).toBe('ZHONG YUAN HAI YUN JIN QU')
  })
})
