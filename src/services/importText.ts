// Fronteira de bytes dos imports (S03 P0-3/§2.1): decode explícito de
// CSV/EDI a partir de ArrayBuffer. XLS/XLSX é binário e nunca passa por aqui.
export type ImportTextEncoding = 'utf-8' | 'utf-8-sig' | 'utf-16le' | 'utf-16be' | 'windows-1252'

export type DecodedImportText = {
  text: string
  encoding: ImportTextEncoding
  hadBom: boolean
}

export type DecodeImportBytesOptions = {
  /** Fallback Windows-1252 somente para origem autorizada (ex.: Baplie legado). Default estrito. */
  allowWindows1252Fallback?: boolean
}

// Magic de planilha binária: ZIP (xlsx) e OLE (xls). Texto nunca começa assim.
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]

export function isBinarySpreadsheetBuffer(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 4) return false
  const isZip = ZIP_MAGIC.every((b, i) => bytes[i] === b)
  const isOle = OLE_MAGIC.every((b, i) => bytes[i] === b)
  return isZip || isOle
}

export function decodeImportBytes(buffer: ArrayBuffer, options: DecodeImportBytesOptions = {}): DecodedImportText {
  if (isBinarySpreadsheetBuffer(buffer)) {
    throw new Error('Arquivo binário (XLS/XLSX) não deve passar pelo decoder textual. Use leitura binária.')
  }
  const bytes = new Uint8Array(buffer)
  // BOM UTF-8
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(3))
    return { text: normalizeLineEndings(text), encoding: 'utf-8-sig', hadBom: true }
  }
  // BOM UTF-16
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    const text = new TextDecoder('utf-16le', { fatal: true }).decode(bytes.slice(2))
    return { text: normalizeLineEndings(text), encoding: 'utf-16le', hadBom: true }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const text = new TextDecoder('utf-16be', { fatal: true }).decode(bytes.slice(2))
    return { text: normalizeLineEndings(text), encoding: 'utf-16be', hadBom: true }
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { text: normalizeLineEndings(text), encoding: 'utf-8', hadBom: false }
  } catch {
    if (!options.allowWindows1252Fallback) {
      throw new Error('Bytes inválidos em UTF-8 sem fallback autorizado. Converta a origem para UTF-8 ou autorize Windows-1252.')
    }
    const text = new TextDecoder('windows-1252').decode(bytes)
    return { text: normalizeLineEndings(text), encoding: 'windows-1252', hadBom: false }
  }
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}
