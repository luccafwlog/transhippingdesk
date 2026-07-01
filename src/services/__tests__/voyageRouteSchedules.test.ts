import { describe, expect, it } from 'vitest'
import { deriveAutomaticVoyagePodCeStatus } from '../voyageRouteSchedules'

describe('deriveAutomaticVoyagePodCeStatus', () => {
  it('deriva o status automatico sem promover para aprovado', () => {
    expect(deriveAutomaticVoyagePodCeStatus(0, 3)).toBe('missing')
    expect(deriveAutomaticVoyagePodCeStatus(1, 3)).toBe('launching')
    expect(deriveAutomaticVoyagePodCeStatus(3, 3)).toBe('approving')
  })

  it('nao deriva status quando nao ha B/Ls na rota', () => {
    expect(deriveAutomaticVoyagePodCeStatus(0, 0)).toBeNull()
  })
})
