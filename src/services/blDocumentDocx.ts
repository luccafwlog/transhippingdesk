// Extração de texto de um B/L em .docx (modelo de formulário preenchido em
// caixas de texto sobre a imagem do B/L em branco). Módulo de leitura pura:
// devolve os blocos de texto na ordem do documento, sem regra de negócio —
// a identificação dos campos vive em blDocumentParser.ts.
import { readZipTextEntry } from '../lib/zipEntry'
import type { BlTextBlock } from './blDocumentSource'

const DOCUMENT_ENTRY = 'word/document.xml'

/**
 * Lê os blocos de texto do .docx na ordem do documento.
 *
 * O modelo de B/L em Word não tem rótulos legíveis: o formulário é uma imagem
 * e cada campo é uma caixa de texto posicionada sobre ela. Por isso o que
 * importa aqui é preservar a fronteira de cada caixa (um campo por bloco) e a
 * ordem em que aparecem, que é o que blDocumentParser usa para separar
 * shipper, consignee e notify.
 */
export async function extractDocxTextBlocks(buffer: ArrayBuffer): Promise<BlTextBlock[]> {
  const xml = stripAlternateContentFallbacks(await readZipTextEntry(buffer, DOCUMENT_ENTRY))
  const textBoxes = extractTextBoxBlocks(xml)
  const blocks = textBoxes.length ? textBoxes : extractParagraphBlocks(xml)
  return blocks
    .map((lines, index) => toBlock(lines, index))
    .filter((block): block is BlTextBlock => block !== null)
    .map((block, index) => ({ ...block, order: index }))
}

function toBlock(lines: string[], order: number): BlTextBlock | null {
  const cleaned = lines.map((line) => normalizeSpaces(line))
  const meaningful = cleaned.filter((line) => line.length > 0)
  if (!meaningful.length) return null
  return { order, page: 1, x: null, y: null, lines: meaningful, text: meaningful.join('\n') }
}

/**
 * Word grava a mesma caixa de texto duas vezes: `mc:Choice` (DrawingML) e
 * `mc:Fallback` (VML, para leitores antigos). Ler as duas duplicaria todo
 * campo do B/L, então a cópia de compatibilidade sai antes do parse.
 */
function stripAlternateContentFallbacks(xml: string) {
  const parts: string[] = []
  let cursor = 0

  for (;;) {
    const start = xml.indexOf('<mc:Fallback>', cursor)
    if (start < 0) {
      parts.push(xml.slice(cursor))
      return parts.join('')
    }

    parts.push(xml.slice(cursor, start))
    const end = findClosingTag(xml, start, '<mc:Fallback', '</mc:Fallback>')
    if (end < 0) return parts.join('') + xml.slice(start)
    cursor = end
  }
}

function extractTextBoxBlocks(xml: string) {
  const blocks: string[][] = []
  let cursor = 0

  for (;;) {
    const open = xml.indexOf('<w:txbxContent>', cursor)
    if (open < 0) return blocks

    const close = findClosingTag(xml, open, '<w:txbxContent', '</w:txbxContent>')
    if (close < 0) return blocks

    blocks.push(extractParagraphBlocks(xml.slice(open, close)).flat())
    cursor = close
  }
}

function extractParagraphBlocks(xml: string) {
  const paragraphs: string[][] = []
  for (const match of xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
    paragraphs.push([paragraphText(match[1])])
  }
  return paragraphs
}

function paragraphText(paragraphXml: string) {
  const withoutFieldCodes = paragraphXml.replace(/<w:instrText[\s\S]*?<\/w:instrText>/g, '')
  const withBreaks = withoutFieldCodes.replace(/<w:(?:br|tab)\b[^>]*\/?>/g, ' ')
  const runs = Array.from(withBreaks.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)).map((match) =>
    decodeXmlEntities(match[1]),
  )
  return runs.join('')
}

/** Avança até o fechamento do bloco, respeitando aninhamento do mesmo elemento. */
function findClosingTag(xml: string, from: number, openTag: string, closeTag: string) {
  let depth = 0
  let cursor = from

  for (;;) {
    const nextOpen = xml.indexOf(openTag, cursor)
    const nextClose = xml.indexOf(closeTag, cursor)
    if (nextClose < 0) return -1

    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1
      cursor = nextOpen + openTag.length
      continue
    }

    depth -= 1
    cursor = nextClose + closeTag.length
    if (depth <= 0) return cursor
  }
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&')
}

// Espaço fixo e tabulação viram espaço comum, mas a sequência de espaços é
// preservada: no modelo em Word ela é a única separação entre duas colunas do
// formulário ("VITORIA,BRAZIL     THREE").
function normalizeSpaces(value: string) {
  return value.replace(/[\u00a0\u3000\t]/g, ' ').trim()
}
