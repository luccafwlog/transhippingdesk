import { expect, it } from 'vitest'
import { getCargaSoltaVoyageId } from '../cargaSoltaRoute'

it('uses the voyage query parameter as the initial Carga Solta context', () => {
  expect(getCargaSoltaVoyageId(new URLSearchParams('voyage=42'))).toBe('42')
  expect(getCargaSoltaVoyageId(new URLSearchParams())).toBe('')
})
