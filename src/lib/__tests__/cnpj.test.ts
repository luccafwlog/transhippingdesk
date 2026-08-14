import { describe, expect, it } from 'vitest'
import { formatCnpj, isValidCnpj, normalizeCnpj } from '../cnpj'

describe('normalizeCnpj', () => {
  it('remove pontuação, preserva letras e converte para maiúsculas', () => {
    expect(normalizeCnpj('12.abc.345/01de-35')).toBe('12ABC34501DE35')
  })

  it('limita a entrada a 14 posições canônicas', () => {
    expect(normalizeCnpj('12.abc.345/01de-35999')).toBe('12ABC34501DE35')
  })
})

describe('formatCnpj', () => {
  it('aplica a máscara oficial também ao CNPJ alfanumérico', () => {
    expect(formatCnpj('12ABC34501DE35')).toBe('12.ABC.345/01DE-35')
  })
})

describe('isValidCnpj', () => {
  it('aceita um CNPJ numérico válido', () => {
    expect(isValidCnpj('06.352.972/0001-21')).toBe(true)
  })

  it('aceita o exemplo alfanumérico oficial da Receita', () => {
    expect(isValidCnpj('12.ABC.345/01DE-35')).toBe(true)
  })

  it('rejeita CNPJ de caractere repetido, inclusive o zerado', () => {
    // O zerado e o unico repetido que fecha o proprio DV: soma zero, resto
    // zero, DVs "00". Sem a guarda ele passaria como valido e viraria cliente
    // e, na sequencia, identificador de login do Portal.
    expect(isValidCnpj('00.000.000/0000-00')).toBe(false)
    expect(isValidCnpj('11.111.111/1111-11')).toBe(false)
    expect(isValidCnpj('AA.AAA.AAA/AAAA-AA')).toBe(false)
  })

  it('rejeita DV incorreto e caracteres fora do alfabeto permitido', () => {
    expect(isValidCnpj('12.ABC.345/01DE-36')).toBe(false)
    expect(isValidCnpj('12.ABC.345/01D$-35')).toBe(false)
  })
})
