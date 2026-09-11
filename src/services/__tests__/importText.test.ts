import { describe, expect, it } from 'vitest'
import {
  decodeImportBytes,
  detectImportFormat,
  encodeImportText,
  inspectImportFile,
  isBinarySpreadsheetBuffer,
} from '../importText'

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

  it('preserva bytes UTF-8 com BOM e line endings para round-trip exato', () => {
    const source = '\uFEFFVITÓRIA\r\nSÃO PAULO\r\n'
    const bytes = new TextEncoder().encode(source).buffer as ArrayBuffer
    const decoded = decodeImportBytes(bytes)

    expect(decoded.text).toBe('VITÓRIA\nSÃO PAULO\n')
    expect(new Uint8Array(encodeImportText(decoded))).toEqual(new Uint8Array(bytes))
  })

  it('preserva bytes Windows-1252 com caracteres estendidos para round-trip exato', () => {
    const bytes = new Uint8Array([0x53, 0xe3, 0x6f, 0x20, 0x96, 0x20, 0x80]).buffer as ArrayBuffer
    const decoded = decodeImportBytes(bytes, { allowWindows1252Fallback: true })

    expect(decoded.text).toBe('São – €')
    expect(new Uint8Array(encodeImportText(decoded))).toEqual(new Uint8Array(bytes))
  })
})

describe('detectImportFormat', () => {
  it('detecta XLSX e XLS pelo conteúdo binário', () => {
    expect(detectImportFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer)).toBe('xlsx')
    expect(detectImportFormat(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]).buffer)).toBe('xls')
  })

  it('detecta CSV delimitado por ponto e vírgula', () => {
    const bytes = new TextEncoder().encode('BL;Container\nBL-1;MSCU1234567').buffer as ArrayBuffer
    expect(detectImportFormat(bytes)).toBe('csv')
  })

  it('desambigua CSV pt-BR com ponto e vírgula e vírgula decimal', () => {
    const bytes = new TextEncoder().encode('Item;Preco;Taxa\n1;1,50;2,30\n2;3,40;4,50').buffer as ArrayBuffer
    expect(detectImportFormat(bytes)).toBe('csv')
  })

  it('detecta CSV de coluna única estruturado', () => {
    const bytes = new TextEncoder().encode('Container\nMSCU1234567\nTEMU7654321').buffer as ArrayBuffer
    expect(detectImportFormat(bytes)).toBe('csv')
  })

  it('preserva campos entre aspas com quebra de linha na detecção de CSV', () => {
    const bytes = new TextEncoder().encode('BL;Obs\nBL-1;"linha 1\nlinha 2"\nBL-2;"obs normal"').buffer as ArrayBuffer
    expect(detectImportFormat(bytes)).toBe('csv')
  })

  it('detecta EDI EDIFACT e arquivo posicional do Mercante', () => {
    const edifact = new TextEncoder().encode("UNB+UNOA:2+X+Y'UNH+1+BAPLIE:D:95B:UN:SMDG22'").buffer as ArrayBuffer
    expect(detectImportFormat(edifact)).toBe('edi')

    const mercante = new TextEncoder().encode('M50001226501030729                       CNTAGBRVIXCN001321\nC50001226501030729  122605179628557                              CSC45360805C00').buffer as ArrayBuffer
    expect(detectImportFormat(mercante)).toBe('edi')

    const mercanteSingleSpace = new TextEncoder().encode('M50001226501030729 CNTAGBRVIX\nC50001226501030729 122605179628557 CSC45360805C00').buffer as ArrayBuffer
    expect(detectImportFormat(mercanteSingleSpace)).toBe('edi')
  })

  it('recusa texto sem formato reconhecível e delimitadores ambíguos', () => {
    const unknown = new TextEncoder().encode('apenas uma observação').buffer as ArrayBuffer
    expect(() => detectImportFormat(unknown)).toThrow(/não reconhecido/i)

    const ambiguous = new TextEncoder().encode('A,B;C\nD,E;F').buffer as ArrayBuffer
    expect(() => detectImportFormat(ambiguous)).toThrow(/ambíguo/i)
  })
})

describe('inspectImportFile', () => {
  it('expõe formato, encoding e prévia textual sem alterar o conteúdo exibido', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('BL;Cidade\n1;Vitória')])
    expect(inspectImportFile(bytes.buffer as ArrayBuffer)).toEqual({
      format: 'csv',
      encoding: 'utf-8-sig',
      hadBom: true,
      preview: 'BL;Cidade\n1;Vitória',
      byteLength: bytes.byteLength,
    })
  })
})
