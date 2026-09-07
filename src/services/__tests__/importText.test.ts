import { describe, expect, it } from 'vitest'
import { decodeImportBytes, isBinarySpreadsheetBuffer } from '../importText'

describe('decodeImportBytes', () => {
  it('round-trip UTF-8 sem BOM preserva Vitória/São/ç', () => {
    const original = 'VITÓRIA;SÃO PAULO;ç\nBRVIX;BRSSZ;teste'
    const bytes = new TextEncoder().encode(original).buffer as ArrayBuffer
    const decoded = decodeImportBytes(bytes)
    expect(decoded.encoding).toBe('utf-8')
    expect(decoded.hadBom).toBe(false)
    expect(decoded.text).toBe(original)
  })

  it('remove BOM UTF-8 e sinaliza encoding', () => {
    const original = 'VITÓRIA'
    const withoutBom = new TextEncoder().encode(original)
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...withoutBom])
    const decoded = decodeImportBytes(withBom.buffer as ArrayBuffer)
    expect(decoded.encoding).toBe('utf-8-sig')
    expect(decoded.hadBom).toBe(true)
    expect(decoded.text).toBe(original)
  })

  it('rejeita bytes inválidos sem fallback autorizado', () => {
    const latin1 = new Uint8Array([0x53, 0xe3, 0x6f]) // 'S' + 0xE3 + 'o' (ã em latin1, inválido em UTF-8)
    expect(() => decodeImportBytes(latin1.buffer as ArrayBuffer)).toThrow(/sem fallback autorizado/)
  })

  it('usa Windows-1252 somente com origem autorizada', () => {
    const latin1 = new Uint8Array([0x53, 0xe3, 0x6f])
    const decoded = decodeImportBytes(latin1.buffer as ArrayBuffer, { allowWindows1252Fallback: true })
    expect(decoded.encoding).toBe('windows-1252')
    expect(decoded.text).toBe('São')
  })

  it('nunca aceita XLS/XLSX binário pelo decoder textual', () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]).buffer as ArrayBuffer
    expect(isBinarySpreadsheetBuffer(zip)).toBe(true)
    expect(() => decodeImportBytes(zip)).toThrow(/binário/)
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0x00]).buffer as ArrayBuffer
    expect(isBinarySpreadsheetBuffer(ole)).toBe(true)
  })
})
