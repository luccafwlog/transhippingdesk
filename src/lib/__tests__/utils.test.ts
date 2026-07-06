import { describe, expect, it } from 'vitest'

import { toNumber } from '../utils'

describe('toNumber', () => {
  it.each([
    ['1.5', 1.5],
    ['1.234,56', 1234.56],
    ['1,5', 1.5],
    ['10 KGS', 10],
    ['', null],
    [42.7, 42.7],
  ])('parses %p as %p', (value, expected) => {
    expect(toNumber(value)).toBe(expected)
  })
})
