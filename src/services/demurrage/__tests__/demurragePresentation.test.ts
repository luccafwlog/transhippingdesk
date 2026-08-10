import { describe, expect, it } from 'vitest'

import { formatBRL } from '../../../lib/utils'
import { fmtBRL, isPtaxWarningEligible } from '../demurragePresentation'

describe('fmtBRL', () => {
  it('preserva o placeholder nullish e delega valores ao formatador canônico', () => {
    expect(fmtBRL(null)).toBe('---')
    expect(fmtBRL(undefined)).toBe('---')
    expect(fmtBRL(1234.56)).toBe(formatBRL(1234.56))
  })
})

describe('isPtaxWarningEligible', () => {
  it('only allows the PTAX warning from 14:00 onward', () => {
    expect(isPtaxWarningEligible(new Date(2026, 6, 17, 13, 59))).toBe(false)
    expect(isPtaxWarningEligible(new Date(2026, 6, 17, 14, 0))).toBe(true)
  })
})
