import { describe, expect, it } from 'vitest'
import { extractNcmCodes, formatNcm, listBlNcms } from '../ncm'

describe('extractNcmCodes', () => {
  it('extracts a full 8-digit NCM (Modelo Vitória)', () => {
    expect(extractNcmCodes('NCM : 8703.80.00')).toEqual(['87038000'])
  })

  it('extracts a 4-digit NCM NUMBER (Modelo Salvador)', () => {
    expect(extractNcmCodes('NCM NUMBER:2923')).toEqual(['2923'])
  })

  it('excludes UN dangerous-goods numbers written as "UN NCM."', () => {
    expect(extractNcmCodes('NCM : 8703.80.00\nUN NCM.:3556')).toEqual(['87038000'])
  })

  it('returns empty for blank or NCM-less text', () => {
    expect(extractNcmCodes('')).toEqual([])
    expect(extractNcmCodes('WOODEN PACKAGE: NOT APPLICABLE')).toEqual([])
  })
})

describe('formatNcm', () => {
  it('dots 8-digit codes', () => expect(formatNcm('87038000')).toBe('8703.80.00'))
  it('dots 6-digit codes', () => expect(formatNcm('870380')).toBe('8703.80'))
  it('leaves 4-digit codes as-is', () => expect(formatNcm('2923')).toBe('2923'))
})

describe('listBlNcms', () => {
  it('dedupes and formats NCMs from a description, UN excluded', () => {
    const desc = 'BYD DOLPHIN\nNCM : 8703.80.00\nUN NCM.: 3556\nNCM : 8703.80.00'
    expect(listBlNcms(desc)).toEqual(['8703.80.00'])
  })

  it('returns empty list for null', () => {
    expect(listBlNcms(null)).toEqual([])
  })
})
