import { describe, expect, it } from 'vitest'

import { assertUploadFile, assertUploadSize } from '../fileGuard'

describe('assertUploadFile', () => {
  it('aceita extensao permitida dentro do limite', () => {
    expect(() => assertUploadFile(new File(['ok'], 'manifesto.xlsx'), ['xlsx', 'xls'])).not.toThrow()
  })

  it('rejeita arquivo acima do limite', () => {
    const file = new File([new Uint8Array(3)], 'manifesto.xlsx')
    expect(() => assertUploadFile(file, ['xlsx'], 2)).toThrow(/limite é 0 MB/)
  })

  it('rejeita extensao nao permitida com formatos aceitos', () => {
    expect(() => assertUploadFile(new File(['x'], 'manifesto.pdf'), ['xlsx', 'xls', 'csv'])).toThrow(
      'Formato de arquivo não suportado (.pdf). Formatos aceitos: .xlsx, .xls, .csv.',
    )
  })

  it('compara extensao sem diferenciar maiusculas', () => {
    expect(() => assertUploadFile(new File(['ok'], 'REPORT.XLSX'), ['xlsx'])).not.toThrow()
  })

  it('rejeita arquivo sem extensao', () => {
    expect(() => assertUploadFile(new File(['x'], 'manifesto'), ['xlsx'])).toThrow(
      'Formato de arquivo não suportado (sem extensão). Formatos aceitos: .xlsx.',
    )
  })

  it('mantem assertUploadSize compativel', () => {
    expect(() => assertUploadSize(new File([new Uint8Array(3)], 'manifesto.xlsx'), 2)).toThrow(/limite é 0 MB/)
  })
})
