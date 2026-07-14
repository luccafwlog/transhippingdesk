import { describe, expect, it } from 'vitest'
import { maskCnpj, normalizeCnpj } from '../cnpj'

describe('normalizeCnpj', () => {
  it('aceita com e sem máscara', () => {
    expect(normalizeCnpj('12.345.678/0001-90')).toBe('12345678000190')
    expect(normalizeCnpj('12345678000190')).toBe('12345678000190')
  })
  it('rejeita CPF e entradas incompletas', () => {
    expect(normalizeCnpj('12345678901')).toBeNull()
    expect(normalizeCnpj('')).toBeNull()
  })
})

describe('maskCnpj', () => {
  it('preserva somente prefixo, filial e DV', () => {
    expect(maskCnpj('12345678000190')).toBe('12.***.***/0001-90')
  })
})
