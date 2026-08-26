import { assertUploadFile } from '../lib/fileGuard'
import { normalizeIsoContainerNumber } from '../lib/containerNumber'
import { normalizePortCode } from './portCode'

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
}

// Qualificadores EDIFACT (3227) que cada armador usa para o mesmo dado. O
// mesmo trecho do Baplie aparece como LOC+6/LOC+12 num arquivo e LOC+9/LOC+11
// no outro (SMDG D95B), e o peso ora vem como MEA+WT ora como MEA+VGM. Ler só
// um dos dialetos deixava POL, POD e peso nulos no arquivo inteiro.
const POL_QUALIFIERS = new Set(['6', '9'])
const POD_QUALIFIERS = new Set(['11', '12'])
const FINAL_DEST_QUALIFIERS = new Set(['83'])
const WEIGHT_QUALIFIERS = new Set(['WT', 'VGM'])
const SLOT_QUALIFIER = '147'

export async function parseBaplieFile(file: File): Promise<ParsedBaplie> {
  assertUploadFile(file, ['edi', 'txt', 'edi2', 'bpl'])
  const text = await file.text()
  return parseBaplieText(text)
}

function parseBaplieText(text: string): ParsedBaplie {
  const segments = text
    .split("'")
    .map((s) => s.trim())
    .filter(Boolean)

  let vessel_name: string | null = null
  let voyage_number: string | null = null

  for (const seg of segments) {
    if (seg.startsWith('TDT+20+')) {
      const parts = seg.split('+')
      voyage_number = parts[2] ?? null
      // O nome do navio é o último composto do TDT ("5LFD3:103::GREEN
      // PARANAGUA"), e quantos elementos vazios vêm antes dele muda de armador
      // para armador — por isso a busca é de trás para frente.
      const vesselPart = [...parts].reverse().find((part) => part.includes('::')) ?? ''
      const colonIdx = vesselPart.indexOf('::')
      if (colonIdx !== -1) {
        vessel_name = vesselPart.slice(colonIdx + 2).replace(/:/g, ' ').trim() || null
      }
    }
  }

  const containers: BaplieContainer[] = []

  // Accumulate per-container state
  let slot: string | null = null
  let weight_kg: number | null = null
  let pol: string | null = null
  let pod: string | null = null
  let final_dest: string | null = null
  let bl_ref: string | null = null
  let oog_dims: boolean = false
  let currentContainer: BaplieContainer | null = null

  for (const seg of segments) {
    if (seg.startsWith('LOC+')) {
      const qualifier = seg.split('+')[1] ?? ''
      const code = extractLocCode(seg)

      if (qualifier === SLOT_QUALIFIER) {
        slot = code
        weight_kg = null
        pol = null
        pod = null
        final_dest = null
        bl_ref = null
        oog_dims = false
        currentContainer = null
        continue
      }

      if (POL_QUALIFIERS.has(qualifier)) pol = normalizePortCode(code)
      else if (POD_QUALIFIERS.has(qualifier)) pod = normalizePortCode(code)
      else if (FINAL_DEST_QUALIFIERS.has(qualifier)) final_dest = normalizePortCode(code)
      continue
    }

    if (seg.startsWith('MEA+')) {
      const parts = seg.replace(/'$/, '').split('+')
      if (!WEIGHT_QUALIFIERS.has(parts[1] ?? '')) continue
      const value = (parts[3] ?? '').split(':')[1] ?? ''
      const n = parseFloat(value)
      weight_kg = isNaN(n) ? null : n
      continue
    }

    if (seg.startsWith('DIM+')) {
      // Any DIM segment with a non-zero value = OOG
      const parts = seg.split('+')
      const dims = (parts[2] ?? '').replace(/'$/, '').split(':')
      const hasValue = dims.some((d) => d.trim() !== '' && d.trim() !== '0')
      if (hasValue) oog_dims = true
      continue
    }

    if (seg.startsWith('RFF+BM:')) {
      bl_ref = seg.slice('RFF+BM:'.length).replace(/'$/, '') || null
      continue
    }

    if (seg.startsWith('EQD+CN+')) {
      const parts = seg.replace(/'$/, '').split('+')
      const rawNumber = parts[2] ?? ''
      const container_number = normalizeIsoContainerNumber(rawNumber)
      if (!container_number) {
        currentContainer = null
        continue
      }
      const size_type = parts[3] ?? null
      const statusCode = parts[6] ?? ''
      const status: BaplieContainer['status'] = statusCode === '4' ? 'empty' : 'full'

      currentContainer = upsertBaplieContainer(containers, {
        container_number,
        size_type: size_type || null,
        status,
        weight_kg,
        pol,
        pod,
        final_dest,
        bl_ref,
        slot,
        is_imo: false,
        imo_class: null,
        un_number: null,
        is_oog: oog_dims,
      })

      oog_dims = false
      continue
    }

    if (seg.startsWith('DGS+')) {
      // DGS belongs to the EQD immediately preceding
      const parts = seg.replace(/'$/, '').split('+')
      const classPart = parts[2] ?? ''
      const imo_class = classPart.split(':')[0] || null
      const un_number = parts[3] ?? null

      if (currentContainer) {
        currentContainer.is_imo = true
        currentContainer.imo_class = imo_class
        currentContainer.un_number = un_number || null
      }
      continue
    }
  }

  const pods = Array.from(new Set(containers.map((c) => c.pod).filter((p): p is string => Boolean(p)))).sort()

  return { vessel_name, voyage_number, containers, pods }
}

function upsertBaplieContainer(containers: BaplieContainer[], next: BaplieContainer) {
  const existing = containers.find((container) => container.container_number === next.container_number)
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
  existing.is_oog = existing.is_oog || next.is_oog
  return existing
}

/** Código do local do segmento LOC ("LOC+11+BRVIX:139:6" -> "BRVIX"). */
function extractLocCode(seg: string): string | null {
  const parts = seg.replace(/'$/, '').split('+')
  if (parts.length < 3) return null
  return parts[2].split(':')[0] || null
}
