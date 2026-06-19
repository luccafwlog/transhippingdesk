import { describe, expect, it } from 'vitest'
import { extractReviewReasons } from '../useReview'

describe('extractReviewReasons', () => {
  it('extrai a linha canonica mesmo depois de uma nota humana', () => {
    expect(
      extractReviewReasons(
        'Cliente confirmou os dados.\nPendencias de importacao: Cliente sem e-mail cadastrado, Acesso ao portal nao provisionado',
      ),
    ).toEqual([
      'Cliente sem e-mail cadastrado',
      'Acesso ao portal nao provisionado',
    ])
  })

  it('nao transforma nota humana em pendencia', () => {
    expect(extractReviewReasons('Cliente confirmou os dados.')).toEqual([])
  })
})
