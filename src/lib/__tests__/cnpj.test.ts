import { describe, expect, it } from 'vitest'
import { canonicalizeDocument, canonicalizeValidCnpj, extractCnpjFromText, formatCnpj, isValidCnpj, normalizeCnpj } from '../cnpj'

describe('normalizeCnpj', () => {
  it('remove pontuação, preserva letras e converte para maiúsculas', () => {
    expect(normalizeCnpj('12.abc.345/01de-35')).toBe('12ABC34501DE35')
  })

  it('limita a entrada a 14 posições canônicas', () => {
    expect(normalizeCnpj('12.abc.345/01de-35999')).toBe('12ABC34501DE35')
  })
})

describe('canonicalizeDocument', () => {
  // O truncamento de `normalizeCnpj` é máscara de digitação; o banco
  // (`normalize_cnpj`, migration 293) não trunca. Onde a decisão é sobre o
  // documento — validar, comparar com o que está gravado — vale a forma
  // completa, senão as duas pontas discordam do que é o mesmo documento.
  it('não trunca, ao contrário da máscara', () => {
    expect(canonicalizeDocument('12.abc.345/01de-35999')).toBe('12ABC34501DE35999')
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

  // A guarda bruta aceita de 14 a 18 caracteres para deixar passar a
  // pontuação. Um documento sem pontuação e comprido cabia nessa faixa, era
  // aparado até 14 e entregue aos dígitos verificadores já no formato que eles
  // esperam -- e um CNPJ válido com um dígito colado no fim entrava como se
  // fosse ele mesmo.
  it('recusa documento comprido em vez de apará-lo até um CNPJ válido', () => {
    expect(isValidCnpj('06352972000121')).toBe(true)
    expect(isValidCnpj('063529720001219')).toBe(false)
    expect(isValidCnpj('06352972000121999')).toBe(false)
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

describe('canonicalizeValidCnpj', () => {
  it('valida a entrada completa antes de canonicalizar', () => {
    expect(canonicalizeValidCnpj('06.352.972/0001-21')).toBe('06352972000121')
    expect(canonicalizeValidCnpj('063529720001219')).toBeNull()
  })
})

describe('extractCnpjFromText', () => {
  it('preserva o contrato de primeiro match rotulado e validado', () => {
    expect(extractCnpjFromText('CNPJ: 06.352.972/0001-22; CNPJ: 06.352.972/0001-21')).toBeNull()
  })
})
