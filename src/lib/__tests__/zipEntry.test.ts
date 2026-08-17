import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { readZipTextEntry } from '../zipEntry'

const docxFixture = new URL('../../services/__tests__/fixtures/bl-cosco-formulario.docx', import.meta.url)

describe('readZipTextEntry', () => {
  it('lê uma entrada comprimida de um .docx real', async () => {
    const file = await readFile(docxFixture)
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer

    const xml = await readZipTextEntry(buffer, 'word/document.xml')

    expect(xml.startsWith('<?xml')).toBe(true)
    expect(xml).toContain('CSXW33TCVT01')
  })

  // Entradas pequenas costumam ser gravadas sem compressão; o leitor precisa
  // devolver os bytes crus em vez de tentar inflá-los.
  it('lê uma entrada gravada sem compressão', async () => {
    const zip = buildStoredZip('nota.txt', 'CARGA SOLTA')

    await expect(readZipTextEntry(zip, 'nota.txt')).resolves.toBe('CARGA SOLTA')
  })

  it('falha com mensagem própria quando a entrada não existe', async () => {
    const zip = buildStoredZip('nota.txt', 'CARGA SOLTA')

    await expect(readZipTextEntry(zip, 'word/document.xml')).rejects.toThrow(
      'Arquivo compactado sem a entrada "word/document.xml".',
    )
  })

  it('falha quando o arquivo não é um zip', async () => {
    const notAZip = new TextEncoder().encode('conteudo qualquer').buffer

    await expect(readZipTextEntry(notAZip, 'word/document.xml')).rejects.toThrow(/não é um zip válido/)
  })

  it('recusa entrada descomprimida acima do limite', async () => {
    const zip = buildStoredZip('word/document.xml', 'x'.repeat(10 * 1024 * 1024 + 1))

    await expect(readZipTextEntry(zip, 'word/document.xml')).rejects.toThrow(/limite.*descomprim/i)
  })
})

/** Zip mínimo de uma entrada gravada sem compressão (método 0). */
function buildStoredZip(name: string, content: string): ArrayBuffer {
  const encoder = new TextEncoder()
  const nameBytes = encoder.encode(name)
  const data = encoder.encode(content)
  const localHeader = new Uint8Array(30 + nameBytes.length)
  const localView = new DataView(localHeader.buffer)
  localView.setUint32(0, 0x04034b50, true)
  localView.setUint16(4, 10, true)
  localView.setUint32(18, data.length, true)
  localView.setUint32(22, data.length, true)
  localView.setUint16(26, nameBytes.length, true)
  localHeader.set(nameBytes, 30)

  const centralHeader = new Uint8Array(46 + nameBytes.length)
  const centralView = new DataView(centralHeader.buffer)
  centralView.setUint32(0, 0x02014b50, true)
  centralView.setUint32(20, data.length, true)
  centralView.setUint32(24, data.length, true)
  centralView.setUint16(28, nameBytes.length, true)
  centralHeader.set(nameBytes, 46)

  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, 1, true)
  endView.setUint16(10, 1, true)
  endView.setUint32(12, centralHeader.length, true)
  endView.setUint32(16, localHeader.length + data.length, true)

  const zip = new Uint8Array(localHeader.length + data.length + centralHeader.length + end.length)
  let offset = 0
  for (const part of [localHeader, data, centralHeader, end]) {
    zip.set(part, offset)
    offset += part.length
  }
  return zip.buffer
}
