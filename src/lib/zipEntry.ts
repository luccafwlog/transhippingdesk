// Leitor mínimo de ZIP: localiza uma entrada pelo nome e devolve o conteúdo
// já descomprimido. Existe para abrir o `word/document.xml` de um B/L .docx
// sem acrescentar dependência de zip ao bundle — a descompressão usa
// `DecompressionStream('deflate-raw')`, padrão em navegadores modernos e no
// Node do vitest.
//
// ponytail: lê o Central Directory clássico (sem Zip64, sem checagem de CRC e
// sem entradas criptografadas), que é o suficiente para OOXML de poucos
// megabytes. Teto = arquivo com mais de 65535 entradas ou acima de 4 GB, que
// exige Zip64. Upgrade path = trocar por uma biblioteca de zip se algum
// formato de importação passar a exigir isso.

const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const CENTRAL_FILE_HEADER = 0x02014b50
const MAX_COMMENT_BYTES = 65_535

type ZipEntryLocation = {
  method: number
  compressedSize: number
  localHeaderOffset: number
}

/** Lê uma entrada do zip como texto UTF-8. Lança se a entrada não existir. */
export async function readZipTextEntry(buffer: ArrayBuffer, entryName: string): Promise<string> {
  const bytes = await readZipEntry(buffer, entryName)
  return new TextDecoder().decode(bytes)
}

/** Lê uma entrada do zip como bytes. Lança se a entrada não existir. */
export async function readZipEntry(buffer: ArrayBuffer, entryName: string): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const location = findEntry(bytes, view, entryName)
  if (!location) throw new Error(`Arquivo compactado sem a entrada "${entryName}".`)

  const { method, compressedSize, localHeaderOffset } = location
  if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
    throw new Error(`Entrada "${entryName}" com cabeçalho local inválido.`)
  }

  const nameLength = view.getUint16(localHeaderOffset + 26, true)
  const extraLength = view.getUint16(localHeaderOffset + 28, true)
  const start = localHeaderOffset + 30 + nameLength + extraLength
  const data = bytes.subarray(start, start + compressedSize)

  if (method === 0) return data
  if (method !== 8) throw new Error(`Entrada "${entryName}" usa compressão não suportada (${method}).`)
  return inflateRaw(data)
}

function findEntry(bytes: Uint8Array, view: DataView, entryName: string): ZipEntryLocation | null {
  const eocd = findEndOfCentralDirectory(view, bytes.length)
  if (eocd < 0) throw new Error('Arquivo não é um zip válido (fim do diretório central ausente).')

  const entryCount = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const decoder = new TextDecoder()

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== CENTRAL_FILE_HEADER) {
      throw new Error('Arquivo zip com diretório central corrompido.')
    }

    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localHeaderOffset = view.getUint32(offset + 42, true)
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))

    if (name === entryName) return { method, compressedSize, localHeaderOffset }
    offset += 46 + nameLength + extraLength + commentLength
  }

  return null
}

function findEndOfCentralDirectory(view: DataView, size: number) {
  const lowestOffset = Math.max(0, size - MAX_COMMENT_BYTES - 22)
  for (let offset = size - 22; offset >= lowestOffset; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) return offset
  }
  return -1
}

async function inflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Este navegador não suporta a leitura de arquivos .docx (DecompressionStream ausente).')
  }

  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(data)
      controller.close()
    },
  })
  const inflated = source.pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(inflated).arrayBuffer())
}
