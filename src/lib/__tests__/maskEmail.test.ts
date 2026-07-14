import { describe, expect, it } from 'vitest'
import { maskEmail } from '../maskEmail'

describe('maskEmail', () => {
  it('preserva só a inicial do local e do domínio', () => {
    expect(maskEmail('financeiro@empresa.com.br')).toBe('f***@e***.br')
  })
  it('não explode com entrada inválida', () => {
    expect(maskEmail('sem-arroba')).toBe('***')
  })
})
