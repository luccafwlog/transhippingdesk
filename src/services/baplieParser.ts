import { assertUploadFile } from '../lib/fileGuard'
import { normalizeIsoContainerNumber } from '../lib/containerNumber'
import { parseImportNumber } from '../lib/importNumber'
import { resolvePortCode } from './portCode'
import { decodeImportBytes, type ImportTextEncoding } from './importText'
import type { ImportIssue } from './importValidation'

export type BaplieContainer = {
  container_number: string
  size_type: string | null
  status: 'full' | 'empty'
  weight_kg: number | null
  pol: string | null
  pod: string | null
  final_dest: string | null
  bl_ref: string | null
  slot: string | null
  is_imo: boolean
  imo_class: string | null
  un_number: string | null
  is_oog: boolean
}

export type ParsedBaplie = {
  vessel_name: string | null
  voyage_number: string | null
  containers: BaplieContainer[]
  pods: string[]
  issues: ImportIssue[]
  encoding: ImportTextEncoding
}

const POL_QUALIFIERS = new Set(['6', '9'])
const POD_QUALIFIERS = new Set(['11', '12'])
const FINAL_DEST_QUALIFIERS = new Set(['83'])
const WEIGHT_QUALIFIERS = new Set(['WT', 'VGM'])
const SLOT_QUALIFIER = '147'

type Delimiters = { component: string; element: string; release: string; terminator: string }

function parseDelimiters(text: string): { delimiters: Delimiters; body: string } {
  if (text.startsWith('UNA') && text.length >= 9) {
    const chars = text.slice(3, 9)
    return {
      delimiters: {
        component: chars[0] ?? ':',
        element: chars[1] ?? '+',
        release: chars[3] ?? '?',
        terminator: chars[5] ?? "'",
      },
      body: text.slice(9),
    }
  }
  return { delimiters: { component: ':', element: '+', release: '?', terminator: "'" }, body: text }
}

function splitRespectingRelease(input: string, delimiter: string, release: string): string[] {
  const parts: string[] = []
  let current = ''
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]
    if (char === release && i + 1 < input.length) {
      current += input[i + 1]
      i += 1
      continue
    }
    if (char === delimiter) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)
  return parts
}

function splitSegments(body: string, delimiters: Delimiters): string[] {
  const segments: string[] = []
  let current = ''
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i]
    if (char === delimiters.release && i + 1 < body.length) {
      current += char + body[i + 1]!
      i += 1
      continue
    }
    if (char === delimiters.terminator) {
      if (current.trim()) segments.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) segments.push(current.trim())
  return segments
}

type ParsedSegment = { tag: string; rawElements: string[]; components: string[][] }

function parseSegment(seg: string, delimiters: Delimiters): ParsedSegment {
  const rawElements = splitRespectingRelease(seg, delimiters.element, delimiters.release)
  const components = rawElements.map((el) => splitRespectingRelease(el, delimiters.component, delimiters.release))
  return { tag: (components[0]?.[0] ?? '').trim().toUpperCase(), rawElements, components }
}

function qualifierOf(segment: ParsedSegment): string {
  return (segment.components[1]?.[0] ?? '').trim()
}

function locCodeOf(segment: ParsedSegment): string | null {
  const code = (segment.components[2]?.[0] ?? '').trim()
  return code || null
}

export async function parseBaplieFile(file: File): Promise<ParsedBaplie> {
  assertUploadFile(file, ['edi', 'txt', 'edi2', 'bpl'])
  const buffer = await file.arrayBuffer()
  return parseBaplieBuffer(buffer)
}

export function parseBaplieBuffer(buffer: ArrayBuffer): ParsedBaplie {
  const decoded = decodeImportBytes(buffer, { allowWindows1252Fallback: true })
  const parsed = parseBaplieText(decoded.text)
  return { ...parsed, encoding: decoded.encoding }
}

export function parseBaplieText(text: string): ParsedBaplie {
  const { delimiters, body } = parseDelimiters(text)
  const rawSegments = splitSegments(body, delimiters)
  const segments = rawSegments.map((seg) => parseSegment(seg, delimiters))

  let vessel_name: string | null = null
  let voyage_number: string | null = null

  for (const seg of segments) {
    if (seg.tag !== 'TDT') continue
    voyage_number = seg.components[2]?.[0]?.trim() || null
    const flat = seg.components.flat().map((c) => c.trim()).filter(Boolean)
    const vessel = [...flat].reverse().find((part) => /[A-Z]/.test(part) && part !== '20')
    // O nome é o último composto alfabético do TDT; o número da viagem já saiu acima.
    if (vessel && vessel !== voyage_number) {
      vessel_name = vessel.replace(/:/g, ' ').trim() || null
    }
  }

  type Group = { slot: string | null; items: ParsedSegment[]; order: number }
  const groups: Group[] = []
  let current: Group | null = null
  let groupOrder = 0

  const closeCurrent = () => {
    if (current) groups.push(current)
    current = null
  }

  for (const seg of segments) {
    if (seg.tag === 'LOC' && qualifierOf(seg) === SLOT_QUALIFIER) {
      closeCurrent()
      groupOrder += 1
      current = { slot: locCodeOf(seg), items: [], order: groupOrder }
      continue
    }
    if (seg.tag === 'UNT' || seg.tag === 'UNZ' || seg.tag === 'UNE') {
      closeCurrent()
      continue
    }
    if (seg.tag === 'LOC' || seg.tag === 'MEA' || seg.tag === 'RFF' || seg.tag === 'EQD' || seg.tag === 'DIM' || seg.tag === 'DGS') {
      if (!current) {
        // Segmento de container antes do primeiro slot: grupo implícito sem slot
        // (cobre EDI sem LOC+147 e ordem EQD→LOC no início).
        if (seg.tag === 'EQD') {
          groupOrder += 1
          current = { slot: null, items: [], order: groupOrder }
        } else {
          continue
        }
      }
      current.items.push(seg)
      continue
    }
  }
  closeCurrent()

  const containers: BaplieContainer[] = []
  const issues: ImportIssue[] = []
  const seen = new Map<string, number>()

  const upsert = (next: BaplieContainer) => {
    const existing = containers.find((c) => c.container_number === next.container_number)
    if (!existing) {
      containers.push(next)
      return next
    }
    existing.size_type = next.size_type ?? existing.size_type
    existing.status = existing.status === 'full' || next.status === 'full' ? 'full' : 'empty'
    existing.weight_kg = next.weight_kg ?? existing.weight_kg
    existing.pol = next.pol ?? existing.pol
    existing.pod = next.pod ?? existing.pod
    existing.final_dest = next.final_dest ?? existing.final_dest
    existing.bl_ref = next.bl_ref ?? existing.bl_ref
    existing.slot = next.slot ?? existing.slot
    existing.is_imo = existing.is_imo || next.is_imo
    existing.imo_class = existing.imo_class ?? next.imo_class
    existing.un_number = existing.un_number ?? next.un_number
    existing.is_oog = existing.is_oog || next.is_oog
    return existing
  }

  for (const group of groups) {
    const eqdIndices = group.items.map((item, idx) => ({ item, idx })).filter(({ item }) => item.tag === 'EQD')
    if (eqdIndices.length === 0) {
      issues.push({
        row: group.order,
        field: 'slot',
        code: 'invalid_group',
        severity: 'warning',
        message: `Conjunto físico ${group.order} (slot ${group.slot ?? 'sem slot'}) sem container EQD.`,
      })
      continue
    }

    // Grupo completo antes de emitir: coleta campos do grupo inteiro para o
    // caso de 1 EQD (cobre LOC→EQD e EQD→LOC); com EQDs consecutivos cada EQD
    // após o primeiro não herda nada do anterior.
    const groupPol = lastPort(group.items, POL_QUALIFIERS)
    const groupPod = lastPort(group.items, POD_QUALIFIERS)
    const groupFinal = lastPort(group.items, FINAL_DEST_QUALIFIERS)
    const groupBl = lastValue(group.items.filter((i) => i.tag === 'RFF' && (i.components[1]?.[0] ?? '') === 'BM').map((i) => i.components[1]?.[1]?.trim() || null))
    const weightValues = group.items
      .filter((i) => i.tag === 'MEA' && WEIGHT_QUALIFIERS.has((i.components[1]?.[0] ?? '').trim()))
      .map((i) => parseWeight(i))
    const groupWeightResult = lastValue(weightValues)
    const groupWeight = groupWeightResult?.value ?? null
    const groupOog = group.items.some((i) => i.tag === 'DIM' && hasOogDims(i))

    eqdIndices.forEach(({ item: eqd }, eqdPos) => {
      const rawNumber = (eqd.components[2]?.[0] ?? '').trim()
      const container_number = normalizeIsoContainerNumber(rawNumber)
      if (!container_number) {
        issues.push({
          row: group.order,
          field: 'container_number',
          code: 'invalid_group',
          severity: 'error',
          message: `Conjunto físico ${group.order}: número de container inválido (${rawNumber || 'ausente'}).`,
        })
        return
      }
      if (seen.has(container_number)) {
        issues.push({
          row: group.order,
          field: 'container_number',
          code: 'invalid_group',
          severity: 'error',
          message: `Container ${container_number} duplicado (conjuntos ${seen.get(container_number)} e ${group.order}).`,
        })
      } else {
        seen.set(container_number, group.order)
      }

      const size_type = eqd.components[3]?.[0]?.trim() || null
      const statusCode = (eqd.components[5]?.[0] ?? eqd.components[6]?.[0] ?? '').trim()
      const status: BaplieContainer['status'] = statusCode === '4' ? 'empty' : 'full'

      // EQDs consecutivos no mesmo slot: só o primeiro recebe os campos do
      // grupo; os demais partem de nulo (sem herança).
      const isFirst = eqdPos === 0
      const dgsList = group.items.filter((i) => i.tag === 'DGS')
      // DGS pertence ao EQD imediatamente anterior: com 1 EQD usa o (último)
      // DGS do grupo; com N EQDs cada DGS após o k-ésimo EQD vai para ele.
      const dgsForThis = pickDgsForEqd(group.items, eqd, dgsList)

      const next: BaplieContainer = {
        container_number,
        size_type,
        status,
        weight_kg: isFirst ? groupWeight : null,
        pol: isFirst ? groupPol.code : null,
        pod: isFirst ? groupPod.code : null,
        final_dest: isFirst ? groupFinal.code : null,
        bl_ref: isFirst ? groupBl : null,
        slot: group.slot,
        is_imo: Boolean(dgsForThis),
        imo_class: dgsForThis?.imo_class ?? null,
        un_number: dgsForThis?.un_number ?? null,
        is_oog: groupOog && isFirst ? true : dgsForThis ? groupOog : group.items.some((i) => i.tag === 'DIM' && hasOogDims(i) && isFirst),
      }
      // OOG: qualquer DIM com valor no grupo marca o primeiro; em grupos com
      // vários EQDs o DIM entre eles já foi atribuído ao anterior via ordem —
      // aqui simplificado para o primeiro não herdar falso positivo.
      const created = upsert(next)
      // Garante que duplicata preserve atributos físicos (compat) sem herdar
      // POL/POD/peso para unidades distintas.
      if (seen.get(container_number) !== group.order) {
        created.is_oog = created.is_oog || next.is_oog
      }

      if (isFirst && (!groupPol.code || !groupPol.recognized)) {
        issues.push({
          row: group.order,
          field: 'pol',
          code: 'unknown_port',
          severity: 'error',
          message: `Container ${container_number}: POL ${groupPol.code ? 'não reconhecido' : 'ausente'} no conjunto ${group.order}.`,
        })
      }
      if (isFirst && (!groupPod.code || !groupPod.recognized)) {
        issues.push({
          row: group.order,
          field: 'pod',
          code: 'unknown_port',
          severity: 'error',
          message: `Container ${container_number}: POD ${groupPod.code ? 'não reconhecido' : 'ausente'} no conjunto ${group.order}.`,
        })
      }
      if (isFirst && groupWeightResult?.issue) {
        issues.push({
          row: group.order,
          field: 'weight_kg',
          code: 'invalid_number',
          severity: 'error',
          message: `Container ${container_number}: peso inválido no conjunto ${group.order}.`,
        })
      } else if (isFirst && next.status === 'full' && next.weight_kg == null) {
        issues.push({
          row: group.order,
          field: 'weight_kg',
          code: 'invalid_number',
          severity: 'error',
          message: `Container ${container_number}: peso ausente no conjunto ${group.order}.`,
        })
      }
    })
  }

  const pods = Array.from(new Set(containers.map((c) => c.pod).filter((p): p is string => Boolean(p)))).sort()
  return { vessel_name, voyage_number, containers, pods, issues, encoding: 'utf-8' }
}

function lastValue<T>(values: Array<T | null>): T | null {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (values[i] !== null && values[i] !== undefined) return values[i] as T
  }
  return null
}

type ParsedPort = { code: string | null; recognized: boolean }

function lastPort(items: ParsedSegment[], qualifiers: ReadonlySet<string>): ParsedPort {
  const raw = lastValue(items
    .filter((item) => item.tag === 'LOC' && qualifiers.has(qualifierOf(item)))
    .map(locCodeOf))
  if (!raw) return { code: null, recognized: false }
  const resolved = resolvePortCode(raw)
  return { code: resolved.code, recognized: resolved.recognized }
}

type ParsedWeight = { value: number | null; issue: 'invalid' | null }

function parseWeight(segment: ParsedSegment): ParsedWeight {
  const valueField = segment.rawElements[3] ?? segment.rawElements[2] ?? ''
  const parts = splitRespectingRelease(valueField, ':', '?')
  const value = (parts[1] ?? parts[0] ?? '').trim()
  if (!value) return { value: null, issue: null }

  const parsed = parseImportNumber(value, 'en-US')
  if (parsed.kind !== 'value') return { value: null, issue: 'invalid' }
  const number = Number(parsed.decimal)
  if (!Number.isFinite(number) || number < 0) return { value: null, issue: 'invalid' }
  return { value: number, issue: null }
}

function hasOogDims(segment: ParsedSegment): boolean {
  const dimsRaw = segment.rawElements[2] ?? ''
  const dims = splitRespectingRelease(dimsRaw, ':', '?')
  return dims.some((d) => d.trim() !== '' && d.trim() !== '0')
}

function pickDgsForEqd(
  items: ParsedSegment[],
  eqd: ParsedSegment,
  dgsList: ParsedSegment[],
): { imo_class: string | null; un_number: string | null } | null {
  if (!dgsList.length) return null
  if (dgsList.length === 1) {
    return parseDgs(dgsList[0]!)
  }
  // Vários DGS: usa o primeiro DGS após este EQD; se nenhum após, usa o anterior.
  const eqdIndex = items.indexOf(eqd)
  const after = items.slice(eqdIndex + 1).find((i) => i.tag === 'DGS')
  const target = after ?? [...items.slice(0, eqdIndex)].reverse().find((i) => i.tag === 'DGS')
  return target ? parseDgs(target) : parseDgs(dgsList[0]!)
}

function parseDgs(segment: ParsedSegment): { imo_class: string | null; un_number: string | null } {
  const classPart = segment.components[2]?.[0] ?? ''
  return {
    imo_class: classPart.trim() || null,
    un_number: (segment.components[3]?.[0] ?? '').trim() || null,
  }
}
