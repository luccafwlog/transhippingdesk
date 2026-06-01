import { describe, expect, it } from 'vitest'
import {
  extractErrorText,
  needsCeMercante,
  needsCustomerLink,
  needsWeightFix,
} from '../revisaoHelpers'
import type { ReviewQueueItem } from '../../hooks/useReview'

function item(overrides: Record<string, unknown>): ReviewQueueItem {
  return { source: 'bl', customer_id: 1, review_reasons: [], cargo_mode: 'container', ...overrides } as unknown as ReviewQueueItem
}

describe('needsCustomerLink', () => {
  it('é verdadeiro só quando não há cliente vinculado', () => {
    expect(needsCustomerLink(item({ customer_id: null }))).toBe(true)
    expect(needsCustomerLink(item({ customer_id: 5 }))).toBe(false)
  })
})

describe('needsCeMercante', () => {
  it('só vale para itens de B/L com motivo de CE Mercante', () => {
    expect(needsCeMercante(item({ source: 'granite', review_reasons: ['CE Mercante ausente'] }))).toBe(false)
    expect(needsCeMercante(item({ source: 'bl', review_reasons: ['CE Mercante ausente'] }))).toBe(true)
    expect(needsCeMercante(item({ source: 'bl', review_reasons: ['ceMercante faltando'] }))).toBe(true)
    expect(needsCeMercante(item({ source: 'bl', review_reasons: ['outro motivo'] }))).toBe(false)
  })
})

describe('needsWeightFix', () => {
  it('detecta pelo motivo de revisão', () => {
    expect(needsWeightFix(item({ source: 'bl', review_reasons: ['Weight Ton ausente'] }))).toBe(true)
    expect(needsWeightFix(item({ source: 'bl', review_reasons: ['peso BB invalido'] }))).toBe(true)
  })

  it('detecta carga solta sem peso em toneladas', () => {
    expect(needsWeightFix(item({ source: 'bl', cargo_mode: 'carga_solta', bb_weight_ton: null }))).toBe(true)
    expect(needsWeightFix(item({ source: 'bl', cargo_mode: 'carga_solta', bb_weight_ton: 0 }))).toBe(true)
    expect(needsWeightFix(item({ source: 'bl', cargo_mode: 'carga_solta', bb_weight_ton: 12 }))).toBe(false)
  })

  it('não vale para container sem motivo, nem para fontes não-B/L', () => {
    expect(needsWeightFix(item({ source: 'bl', cargo_mode: 'container' }))).toBe(false)
    expect(needsWeightFix(item({ source: 'granite', cargo_mode: 'carga_solta', bb_weight_ton: null }))).toBe(false)
  })
})

describe('extractErrorText', () => {
  it('normaliza diferentes formatos de erro para minúsculas', () => {
    expect(extractErrorText(new Error('Falha GRAVE'))).toBe('falha grave')
    expect(extractErrorText('Erro X')).toBe('erro x')
    expect(extractErrorText({ code: 'P0001', message: 'Conflito', details: 'D', hint: 'H' })).toBe(
      'p0001 conflito d h',
    )
  })

  it('retorna string vazia para entradas vazias/desconhecidas', () => {
    expect(extractErrorText(null)).toBe('')
    expect(extractErrorText(undefined)).toBe('')
    expect(extractErrorText(123)).toBe('')
  })
})
