import { describe, expect, it } from 'vitest'
import { normalizeCnpj } from '../cnpj'

describe('normalizeCnpj', () => {
  it('remove pontuação ao colar ou digitar um CNPJ', () => {
    expect(normalizeCnpj('26.000.100/0001-01')).toBe('26000100000101')
  })
})
