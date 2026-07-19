import { describe, expect, it } from 'vitest'

import { formatBRL } from '../../../lib/utils'
import { fmtBRL } from '../demurragePresentation'

describe('fmtBRL', () => {
  it('preserva o placeholder nullish e delega valores ao formatador canônico', () => {
    expect(fmtBRL(null)).toBe('---')
    expect(fmtBRL(undefined)).toBe('---')
    expect(fmtBRL(1234.56)).toBe(formatBRL(1234.56))
  })
})
