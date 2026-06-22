import { describe, expect, it } from 'vitest'
import { extractErrorText } from '../errors'

describe('extractErrorText', () => {
  it('junta os campos de um erro do Supabase preservando o casing', () => {
    expect(extractErrorText(new Error('Falha GRAVE'))).toBe('Falha GRAVE')
    expect(extractErrorText('Erro X')).toBe('Erro X')
    expect(extractErrorText({ code: 'P0001', message: 'Conflito', details: 'D', hint: 'H' })).toBe(
      'P0001 Conflito D H',
    )
  })

  it('ignora campos vazios ao juntar', () => {
    expect(extractErrorText({ code: '42501', message: 'permission denied', details: null, hint: '' })).toBe(
      '42501 permission denied',
    )
  })

  it('retorna string vazia para entradas vazias/desconhecidas', () => {
    expect(extractErrorText(null)).toBe('')
    expect(extractErrorText(undefined)).toBe('')
    expect(extractErrorText(123)).toBe('')
  })
})
