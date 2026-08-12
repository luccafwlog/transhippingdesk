import { describe, expect, it } from 'vitest'
import { shouldHydrateProfile } from '../useAuth'

describe('shouldHydrateProfile', () => {
  it('não recarrega o mesmo perfil em eventos repetidos da mesma sessão', () => {
    expect(shouldHydrateProfile('user-1', 'user-1')).toBe(false)
    expect(shouldHydrateProfile('user-2', 'user-1')).toBe(true)
    expect(shouldHydrateProfile('user-1', null)).toBe(true)
  })
})
