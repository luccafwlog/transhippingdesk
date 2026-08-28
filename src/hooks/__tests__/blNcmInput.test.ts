import { describe, expect, it } from 'vitest'
import { formatNcmList, parseNcmInput } from '../useBlEditForm'

describe('NCM cadastrado na ficha do B/L', () => {
  it('aceita o que o operador digita com pontuação, vírgula ou espaço', () => {
    expect(parseNcmInput('5509, 8703.80.00')).toEqual(['5509', '87038000'])
    expect(parseNcmInput('5509 8703.80.00')).toEqual(['5509', '87038000'])
    expect(parseNcmInput('5509; 5509')).toEqual(['5509'])
  })

  it('descarta o que não é NCM: menos de 4 dígitos e texto solto', () => {
    expect(parseNcmInput('55, abc, 123')).toEqual([])
    expect(parseNcmInput('')).toEqual([])
  })

  it('trunca em 8 dígitos, que é o limite do NCM', () => {
    expect(parseNcmInput('8703.80.00.99')).toEqual(['87038000'])
  })

  it('mostra de volta os códigos gravados com a pontuação de leitura', () => {
    expect(formatNcmList(['5509', '87038000'])).toBe('5509, 8703.80.00')
    expect(formatNcmList([])).toBe('')
    expect(formatNcmList(null)).toBe('')
  })

  it('ida e volta é estável: o que sai do banco e volta para ele não muda', () => {
    expect(parseNcmInput(formatNcmList(['5509', '87038000']))).toEqual(['5509', '87038000'])
    // 7 dígitos voltavam com 6: a formatação descartava o último e a próxima edição gravava o código truncado
    expect(parseNcmInput(formatNcmList(['8703800']))).toEqual(['8703800'])
  })
})
