// Identificação dos campos de um B/L de armador a partir do texto extraído.
// Dois caminhos, um contrato: o PDF traz os rótulos impressos do formulário
// ("1.Shipper", "4.Vessel:", "Gross weight") e por isso é lido por âncora de
// rótulo; o .docx é um formulário escaneado com caixas de texto por cima, sem
// nenhum rótulo legível, e por isso é lido por conteúdo. Os dois terminam no
// mesmo `BlDocumentFields`, que blDocumentParser.ts normaliza.
import { normalizeHeader } from '../lib/utils'
import type { BlPdfPage, BlTextBlock, BlTextRun } from './blDocumentSource'

/** Campos crus do B/L, ainda como texto do documento. */
export type BlDocumentFields = {
  blNumber: string | null
  codeName: string | null
  shipper: string | null
  consignee: string | null
  notifyParty: string | null
  /** Navio e viagem como escritos ("DA XIN V75"). */
  vessel: string | null
  pol: string | null
  pod: string | null
  originals: string | null
  marks: string | null
  description: string | null
  grossWeight: string | null
  measurement: string | null
  placeAndDateOfIssue: string | null
  /** Total por extenso ("SAY TOTAL SIX PACKAGES ONLY"), usado como conferência. */
  sayTotal: string | null
  freight: string | null
  remarks: string | null
}

const EMPTY_FIELDS: BlDocumentFields = {
  blNumber: null,
  codeName: null,
  shipper: null,
  consignee: null,
  notifyParty: null,
  vessel: null,
  pol: null,
  pod: null,
  originals: null,
  marks: null,
  description: null,
  grossWeight: null,
  measurement: null,
  placeAndDateOfIssue: null,
  sayTotal: null,
  freight: null,
  remarks: null,
}

// Texto pré-impresso do formulário. Nenhuma dessas linhas é dado do embarque,
// e várias caem dentro do quadro de carga, então sai tudo antes da leitura.
const BOILERPLATE_PATTERNS = [
  /^for conditions of carriage/i,
  /^\(?for carrier'?s use only/i,
  /^serial no\.?$/i,
  /^container no\.?\/seal no\.?$/i,
  /^bill of lading$/i,
  /^code name/i,
  /^praticulars furnished|^particulars furnished/i,
  /^but not acknowledged by the carrier/i,
  /^\(?of which/i,
  /^on deck at merchant/i,
  /^whatsoever and whether due to negligence/i,
  /^shipped at the port of loading/i,
  /^port of discharge or so near/i,
  /^weight,\s*measure, quality/i,
  /^the term apparent good order/i,
  /^reference to iron,\s*steel/i,
  /^rustor moisture|^rust or moisture/i,
  /^definition and setting forth/i,
  /^clerk'?s receipts/i,
  /^in witness whereof/i,
  /^below all of this tenor/i,
  /^\d+\.?\s*applicable law and jurisdiction/i,
  /^this bill of lading is subject to the laws/i,
  /^china and the exclusive jurisdiction/i,
  /^place and date of issue/i,
  /^signed for and on behalf of the carrier/i,
  /^as agent for and on behalf of/i,
  /^carrier:/i,
  /^\d+\.shipper'?s declared value/i,
  /^\d+\.freight and charges/i,
  /^\d{1,2}\.$/,
  /^page \d+\/\d+$/i,
  /^https?:\/\//i,
]

const PDF_LABELS = {
  blNumber: /^b\/l n[or]\.?:?$/,
  codeName: /^code name/,
  shipper: /^1\s*\.?\s*shipper\b/,
  consignee: /^2\s*\.?\s*consignee\b/,
  notifyParty: /^3\s*\.?\s*notify\b/,
  vessel: /^4\s*\.?\s*vessel\b/,
  pol: /^5\s*\.?\s*port of loading\b/,
  pod: /^6\s*\.?\s*port of discharge\b/,
  originals: /^7\s*\.?\s*number of original\b/,
  marksHeader: /^marks and numbers\b/,
  descriptionHeader: /^number and kind of packages/,
  grossWeightHeader: /^gross weight$/,
  measurementHeader: /^measurement$/,
  placeAndDateOfIssue: /^place and date of issue/,
  cargoTableEnd: /^\(?of which/,
} as const

const WEIGHT_PATTERN = /(\d[\d.,]*)\s*(?:KGS?|KILOS?|KILOGRAMS?)\b/i
const MEASUREMENT_PATTERN = /(\d[\d.,]*)\s*(?:CBM|M3|M³|CUBIC METERS?)\b/i
const NET_WEIGHT_PATTERN = /\bNET\s+WEIGHT\b/i
export const SAY_TOTAL_PATTERN = /\b(?:SAY\s+)?TOTAL\s+([A-Z\s-]+?)\s+([A-Z]+)\s+ONLY\b/i
const SHIPS_REMARK_PATTERN = /^ship'?s\s+remarks?\s*:?/i
export const VESSEL_VOYAGE_PATTERN = /^(.*?[A-Z].*?)\s+V(?:OY|OYAGE)?[.\s-]*(\d{1,4}[A-Z]?)\b/i

// ---------------------------------------------------------------------------
// PDF com rótulos do formulário
// ---------------------------------------------------------------------------

/** Lê os campos de um PDF cujo formulário traz os rótulos numerados impressos. */
export function collectFieldsFromPdfLabels(pages: BlPdfPage[]): BlDocumentFields | null {
  const first = pages[0]
  if (!first) return null

  const labels = findLabels(first.runs)
  if (!labels.shipper || !labels.consignee) return null

  const fields: BlDocumentFields = { ...EMPTY_FIELDS }
  fields.blNumber = labels.blNumber ? textRightOf(first.runs, labels.blNumber) : null
  fields.codeName = labels.codeName ? stripLabelPrefix(labels.codeName.text) || textRightOf(first.runs, labels.codeName) : null
  fields.shipper = textBelow(first.runs, labels.shipper, labels.consignee)
  fields.consignee = textBelow(first.runs, labels.consignee, labels.notifyParty ?? labels.vessel)
  fields.notifyParty = labels.notifyParty ? textBelow(first.runs, labels.notifyParty, labels.vessel) : null
  fields.vessel = labels.vessel ? textRightOf(first.runs, labels.vessel, labels.pol?.x) : null
  fields.pol = labels.pol ? textRightOf(first.runs, labels.pol) : null
  fields.pod = labels.pod ? textRightOf(first.runs, labels.pod, labels.originals?.x) : null
  fields.originals = labels.originals ? textRightOf(first.runs, labels.originals) : null
  fields.placeAndDateOfIssue = labels.placeAndDateOfIssue ? textRightOf(first.runs, labels.placeAndDateOfIssue) : null

  applyCargoTable(fields, first, labels)
  fields.remarks = joinLines([fields.remarks, collectAttachmentText(pages)].filter((value): value is string => Boolean(value)))
  return fields
}

type LabelMap = Partial<Record<keyof typeof PDF_LABELS, BlTextRun>>

// Quantos trechos vizinhos entram numa tentativa de rótulo. O formulário
// fragmenta no máximo o número e o texto ("6" + ".Port of Discharge:"), então
// três já cobre a pior quebra sem varrer o valor do campo junto.
const MAX_LABEL_RUNS = 3
const SAME_LINE_TOLERANCE = 1.5

/**
 * Procura os rótulos do formulário linha a linha.
 *
 * O gerador do PDF quebra um rótulo em vários comandos de texto e nem sempre
 * grava a mesma linha de base para todos ("6" sai 0,0002pt abaixo de
 * ".Port of Discharge:"), o que basta para a junção por proximidade de
 * blDocumentPdf.ts entregar os dois trechos separados e fora de ordem. Montar
 * o candidato a partir dos trechos vizinhos da linha, já ordenados pela
 * margem esquerda, reconhece o rótulo nos dois casos; o rótulo devolvido
 * cobre da primeira à última parte, para que o valor à direita continue sendo
 * encontrado pela posição.
 */
function findLabels(runs: BlTextRun[]): LabelMap {
  const labels: LabelMap = {}
  const pending = Object.entries(PDF_LABELS) as [keyof typeof PDF_LABELS, RegExp][]

  for (const line of groupRunsIntoLines(runs)) {
    for (let start = 0; start < line.length; start += 1) {
      const end = Math.min(line.length, start + MAX_LABEL_RUNS)
      for (let last = start; last < end; last += 1) {
        const candidate = joinRunsAsLabel(line.slice(start, last + 1))
        const normalized = normalizeHeader(candidate.text)
        const matched = pending.filter(([name, pattern]) => !labels[name] && pattern.test(normalized))
        if (!matched.length) continue
        for (const [name] of matched) labels[name] = candidate
        break
      }
    }
  }

  return labels
}

/** Agrupa os trechos por linha de base e ordena cada linha pela margem esquerda. */
function groupRunsIntoLines(runs: BlTextRun[]): BlTextRun[][] {
  const lines: BlTextRun[][] = []
  for (const run of [...runs].sort((left, right) => left.y - right.y || left.x - right.x)) {
    const current = lines[lines.length - 1]
    const reference = current?.[0]
    if (current && reference && reference.page === run.page && run.y - reference.y <= SAME_LINE_TOLERANCE) {
      current.push(run)
      continue
    }
    lines.push([run])
  }
  return lines.map((line) => line.sort((left, right) => left.x - right.x))
}

/** Junta trechos vizinhos num único rótulo, preservando posição e largura. */
function joinRunsAsLabel(parts: BlTextRun[]): BlTextRun {
  const first = parts[0]
  const last = parts[parts.length - 1]
  const text = parts.reduce((accumulated, part, index) => {
    if (index === 0) return part.text
    const previous = parts[index - 1]
    const gap = part.x - (previous.x + previous.width)
    return gap > 1 ? `${accumulated} ${part.text}` : `${accumulated}${part.text}`
  }, '')

  return {
    page: first.page,
    x: first.x,
    y: first.y,
    width: last.x + last.width - first.x,
    height: Math.max(...parts.map((part) => part.height)),
    text,
  }
}

/** Valor escrito na mesma linha do rótulo, à direita dele. */
function textRightOf(runs: BlTextRun[], label: BlTextRun, nextLabelX?: number) {
  const limit = nextLabelX ?? Number.POSITIVE_INFINITY
  const values = runs
    .filter(
      (run) =>
        run !== label &&
        run.page === label.page &&
        Math.abs(run.y - label.y) <= 6 &&
        run.x >= label.x + label.width - 1 &&
        run.x < limit &&
        !isBoilerplate(run.text),
    )
    .sort((left, right) => left.x - right.x)
    .map((run) => run.text)

  return joinLines(values)
}

/** Bloco escrito abaixo do rótulo, na mesma coluna, até o próximo rótulo. */
function textBelow(runs: BlTextRun[], label: BlTextRun, nextLabel?: BlTextRun) {
  const bottom = nextLabel && nextLabel.page === label.page ? nextLabel.y : Number.POSITIVE_INFINITY
  const values = runs
    .filter(
      (run) =>
        run !== label &&
        run.page === label.page &&
        run.y > label.y + 1 &&
        run.y < bottom &&
        run.x >= label.x - 6 &&
        run.x < label.x + 250 &&
        !isBoilerplate(run.text),
    )
    .sort((left, right) => left.y - right.y || left.x - right.x)
    .map((run) => run.text)

  return joinLines(values)
}

/**
 * Quadro de carga: marcas, descrição, peso e medida. Peso e medida são
 * reconhecidos pelo conteúdo (a unidade está impressa no próprio valor) e as
 * duas colunas restantes saem da posição — a da esquerda é a de marcas.
 */
function applyCargoTable(fields: BlDocumentFields, page: BlPdfPage, labels: LabelMap) {
  const headerY = Math.max(
    labels.marksHeader?.y ?? 0,
    labels.descriptionHeader?.y ?? 0,
    labels.grossWeightHeader?.y ?? 0,
  )
  if (!headerY) return

  const bottom = (labels.cargoTableEnd?.y ?? Number.POSITIVE_INFINITY) - 3
  const cargoRuns = page.runs
    .filter((run) => run.y > headerY + 1 && run.y < bottom && !isBoilerplate(run.text))
    .sort((left, right) => left.y - right.y || left.x - right.x)

  const weightRun = pickUnitRun(cargoRuns, WEIGHT_PATTERN, labels.grossWeightHeader?.x)
  const measurementRun = pickUnitRun(cargoRuns, MEASUREMENT_PATTERN, labels.measurementHeader?.x)
  fields.grossWeight = weightRun?.text ?? null
  fields.measurement = measurementRun?.text ?? null

  const remaining = cargoRuns.filter((run) => run !== weightRun && run !== measurementRun)
  const columns = clusterByColumn(remaining)
  if (!columns.length) return

  const descriptionLimit = labels.grossWeightHeader?.x ?? Number.POSITIVE_INFINITY
  const dataColumns = columns.filter((column) => column[0].x < descriptionLimit - 20)
  if (dataColumns.length >= 2) {
    fields.marks = joinLines(dataColumns[0].map((run) => run.text))
    applyDescriptionSections(fields, dataColumns.slice(1).flat().map((run) => run.text))
    return
  }

  applyDescriptionSections(fields, dataColumns.flat().map((run) => run.text))
}

/**
 * A coluna de descrição carrega três coisas no mesmo espaço: a descrição da
 * carga, o total por extenso ("TOTAL FIVE CASES ONLY") e a ressalva do navio
 * a partir de "Ship's Remark:". Separá-las aqui evita que o total e a ressalva
 * virem descrição de mercadoria no B/L importado.
 */
function applyDescriptionSections(fields: BlDocumentFields, lines: string[]) {
  const description: string[] = []
  let remarkIndex = -1

  lines.forEach((line, index) => {
    if (remarkIndex >= 0) return
    if (SHIPS_REMARK_PATTERN.test(line)) {
      remarkIndex = index
      return
    }
    if (!fields.sayTotal && SAY_TOTAL_PATTERN.test(line)) {
      fields.sayTotal = line
      return
    }
    description.push(line)
  })

  fields.description = joinLines(description)
  if (remarkIndex >= 0) {
    fields.remarks = joinLines(lines.slice(remarkIndex + 1))
  }
}

function pickUnitRun(runs: BlTextRun[], pattern: RegExp, headerX?: number) {
  const candidates = runs.filter((run) => pattern.test(run.text) && !NET_WEIGHT_PATTERN.test(run.text))
  if (!candidates.length) return null
  if (headerX === undefined) return candidates[0]
  return candidates.reduce((best, run) => (Math.abs(run.x - headerX) < Math.abs(best.x - headerX) ? run : best))
}

/** Agrupa os trechos em colunas pela margem esquerda (folga de 30pt). */
function clusterByColumn(runs: BlTextRun[]) {
  const columns: BlTextRun[][] = []
  for (const run of [...runs].sort((left, right) => left.x - right.x)) {
    const column = columns.find((entries) => Math.abs(entries[0].x - run.x) <= 30)
    if (column) column.push(run)
    else columns.push([run])
  }
  return columns.map((column) => column.sort((left, right) => left.y - right.y))
}

function collectAttachmentText(pages: BlPdfPage[]) {
  const lines = pages
    .slice(1)
    .flatMap((page) => page.runs.map((run) => run.text))
    .filter((text) => !isBoilerplate(text) && !/ATTACHMENT\s*$/i.test(text))
  return joinLines(lines)
}

function stripLabelPrefix(value: string) {
  return value.replace(/^[^:]*:\s*/, '').trim()
}

// ---------------------------------------------------------------------------
// Blocos sem rótulo (.docx e PDFs do modelo escaneado)
// ---------------------------------------------------------------------------

/**
 * Lê os campos quando o formulário não tem rótulo em texto. Cada bloco é um
 * campo preenchido; o que os separa é o conteúdo (unidade, número de viagem,
 * CNPJ, endereço) e a ordem em que o documento os grava.
 */
export function collectFieldsFromBlocks(blocks: BlTextBlock[]): BlDocumentFields {
  const fields: BlDocumentFields = { ...EMPTY_FIELDS }
  const available = blocks.filter((block) => !isBoilerplateBlock(block))
  const claimed = new Set<BlTextBlock>()

  const claim = (block: BlTextBlock | undefined) => {
    if (block) claimed.add(block)
    return block ?? null
  }
  const unclaimed = () => available.filter((block) => !claimed.has(block))

  const weightBlock = claim(unclaimed().find((block) => WEIGHT_PATTERN.test(block.text) && MEASUREMENT_PATTERN.test(block.text)))
  if (weightBlock) {
    fields.grossWeight = matchLine(weightBlock, WEIGHT_PATTERN)
    fields.measurement = matchLine(weightBlock, MEASUREMENT_PATTERN)
  }

  const vesselBlock = claim(unclaimed().find((block) => block.lines.length === 1 && VESSEL_VOYAGE_PATTERN.test(block.text)))
  if (vesselBlock) {
    const [vessel, port] = splitColumns(vesselBlock.text, VESSEL_VOYAGE_PATTERN)
    fields.vessel = vessel
    fields.pol = port
  }

  const podBlock = claim(unclaimed().find((block) => block.lines.length === 1 && isPortAndOriginals(block.text)))
  if (podBlock) {
    const [pod, originals] = splitColumns(podBlock.text, /^(.+?)\s+((?:\d+|[A-Z]+))$/)
    fields.pod = pod
    fields.originals = originals
  }

  fields.sayTotal = claim(unclaimed().find((block) => /^SAY\b|^TOTAL\b.*\bONLY\b/i.test(block.text)))?.text ?? null

  const descriptionBlock = claim(pickDescriptionBlock(unclaimed()))
  if (descriptionBlock) applyDescriptionSections(fields, descriptionBlock.lines)

  fields.blNumber = claim(unclaimed().find((block) => block.lines.length === 1 && isBlNumber(block.text)))?.text ?? null
  fields.placeAndDateOfIssue = claim(unclaimed().find((block) => block.lines.length === 1 && hasIssueDate(block.text)))?.text ?? null
  fields.freight = claim(unclaimed().find((block) => /^FREIGHT\s+(PREPAID|COLLECT)/i.test(block.text)))?.text ?? null

  const remarksBlock = claim(unclaimed().find((block) => block.lines.some((line) => SHIPS_REMARK_PATTERN.test(line))))
  if (remarksBlock) {
    fields.remarks = extractRemarks(remarksBlock.lines)
  }

  const partyBoundary = Math.min(
    ...[descriptionBlock?.order, weightBlock?.order, Number.POSITIVE_INFINITY].filter(
      (order): order is number => order !== undefined,
    ),
  )
  const parties = unclaimed().filter((block) => block.order < partyBoundary && isPartyBlock(block))
  fields.shipper = parties[0]?.text ?? null
  fields.consignee = parties[1]?.text ?? null
  fields.notifyParty = parties[2]?.text ?? null
  parties.slice(0, 3).forEach((block) => claimed.add(block))

  fields.marks = claim(unclaimed().find((block) => block.order > partyBoundary && block.lines.length <= 3))?.text ?? null

  return fields
}

function extractRemarks(lines: string[]) {
  const headerIndex = lines.findIndex((line) => SHIPS_REMARK_PATTERN.test(line))
  if (headerIndex < 0) return null

  const inline = lines[headerIndex]?.replace(SHIPS_REMARK_PATTERN, '').replace(/^\s*:\s*/, '').trim() ?? ''
  return joinLines([inline, ...lines.slice(headerIndex + 1)])
}

/**
 * Agrupa trechos soltos de um PDF sem rótulos em blocos por coluna e
 * proximidade vertical, para que a leitura por conteúdo veja a mesma coisa
 * que vê no .docx: um bloco por campo preenchido.
 */
export function groupRunsIntoBlocks(pages: BlPdfPage[]): BlTextBlock[] {
  const groups: Array<{ page: number; runs: BlTextRun[] }> = []

  for (const page of pages) {
    const runs = [...page.runs].sort((left, right) => left.y - right.y || left.x - right.x)
    let current: { page: number; runs: BlTextRun[] } | null = null

    for (const run of runs) {
      const previous = current?.runs[current.runs.length - 1]
      const continues =
        previous && Math.abs(previous.x - run.x) <= 12 && run.y - previous.y > 0 && run.y - previous.y <= 16

      if (current && continues) {
        current.runs.push(run)
        continue
      }

      current = { page: page.number, runs: [run] }
      groups.push(current)
    }
  }

  return groups.map((group, order) => ({
    order,
    page: group.page,
    x: group.runs[0].x,
    y: group.runs[0].y,
    lines: group.runs.map((run) => run.text),
    text: group.runs.map((run) => run.text).join('\n'),
  }))
}

function pickDescriptionBlock(blocks: BlTextBlock[]) {
  const candidates = blocks.filter((block) => block.lines.some((line) => PACKAGE_LINE_PATTERN.test(line)))
  if (!candidates.length) return undefined
  return candidates.reduce((best, block) => (block.lines.length > best.lines.length ? block : best))
}

const PACKAGE_LINE_PATTERN =
  /^\d+\s+(?:PACKAGES?|PKGS?|CASES?|CARTONS?|CRATES?|BOXES|BUNDLES?|PALLETS?|PIECES?|PCS|UNITS?|BAGS?|DRUMS?|ROLLS?|COILS?|SKIDS?|CTNS?)\b/i

function isPortAndOriginals(value: string) {
  if (!/[A-Z]/.test(value)) return false
  const match = value.match(/^(.+?)\s{2,}([A-Z]+|\d+)$/i) ?? value.match(/^([A-Z .'-]+,\s*[A-Z]+)\s+([A-Z]+|\d+)$/i)
  if (!match) return false
  return /^\d+$/.test(match[2]) || NUMBER_WORDS.has(match[2].toUpperCase())
}

function splitColumns(value: string, pattern: RegExp): [string | null, string | null] {
  const spaced = value.match(/^(.+?)\s{2,}(.+)$/)
  if (spaced) return [spaced[1].trim(), spaced[2].trim()]
  const matched = value.match(pattern)
  if (!matched) return [value.trim() || null, null]
  const left = matched[0].trim()
  const right = value.slice(matched[0].length).trim()
  return [left || null, right || null]
}

/** Trecho da linha que casa com o padrão — peso e medida dividem a mesma linha. */
function matchLine(block: BlTextBlock, pattern: RegExp) {
  for (const line of block.lines) {
    const match = line.match(pattern)
    if (match) return match[0].trim()
  }
  return null
}

function isBlNumber(value: string) {
  const text = value.trim().toUpperCase()
  return /^[A-Z]{2,6}[A-Z0-9]{5,24}$/.test(text) && /\d/.test(text)
}

function hasIssueDate(value: string) {
  return (
    /\b\d{4}-\d{2}-\d{2}\b/.test(value) ||
    /\b\d{1,2}(?:ST|ND|RD|TH)?\s+[A-Z]{3,9}\s+\d{4}\b/i.test(value) ||
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(value)
  )
}

const COMPANY_PATTERN =
  /\b(?:LTDA|LTD|L\.T\.D|S\.A|S\/A|SA|INC|CORP|CO\.,?\s*LTD|GMBH|PTE|PTY|BV|NV|SRL|COMERCIO|INDUSTRIA|SERVICOS|LOGISTICA|LOGISTICS|TRANSPORTES|TRADING|IMPORTACAO|EXPORTACAO|SHIPPING|QUIMICA|GROUP)\b/i
const ADDRESS_PATTERN =
  /\b(?:CNPJ|CPF|TAX\s*ID|TEL|PHONE|FAX|E-?MAIL|CEP|ZIP|RUA|AVENIDA|AV\.|RODOVIA|ROAD|STREET|ROOM|FLOOR|BUILDING|NO\.|Nº)\b/i

function isPartyBlock(block: BlTextBlock) {
  if (COMPANY_PATTERN.test(block.lines[0] ?? '')) return true
  return block.lines.length >= 2 && ADDRESS_PATTERN.test(block.text)
}

function isBoilerplateBlock(block: BlTextBlock) {
  return block.lines.every((line) => isBoilerplate(line))
}

function isBoilerplate(value: string) {
  const text = value.trim()
  if (!text) return true
  return BOILERPLATE_PATTERNS.some((pattern) => pattern.test(text))
}

function joinLines(values: string[]) {
  const lines = values.map((value) => value.trim()).filter(Boolean)
  return lines.length ? lines.join('\n') : null
}

export const NUMBER_WORDS = new Map<string, number>([
  ['ZERO', 0], ['ONE', 1], ['TWO', 2], ['THREE', 3], ['FOUR', 4], ['FIVE', 5], ['SIX', 6], ['SEVEN', 7],
  ['EIGHT', 8], ['NINE', 9], ['TEN', 10], ['ELEVEN', 11], ['TWELVE', 12], ['THIRTEEN', 13], ['FOURTEEN', 14],
  ['FIFTEEN', 15], ['SIXTEEN', 16], ['SEVENTEEN', 17], ['EIGHTEEN', 18], ['NINETEEN', 19], ['TWENTY', 20],
  ['THIRTY', 30], ['FORTY', 40], ['FIFTY', 50], ['SIXTY', 60], ['SEVENTY', 70], ['EIGHTY', 80], ['NINETY', 90],
])
