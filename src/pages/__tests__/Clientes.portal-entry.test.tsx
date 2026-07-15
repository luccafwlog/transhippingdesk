import { describe, expect, it } from 'vitest'
import { primaryNavItems } from '../../components/layout/appLayoutNav'

describe('entrada do provisionamento no contexto de Clientes', () => {
  it('remove o console da navegação primária', () => {
    expect(primaryNavItems.some((item) => item.to === '/clientes/portal')).toBe(false)
  })
})
