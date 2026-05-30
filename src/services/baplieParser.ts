import { assertUploadSize } from '../lib/fileGuard'
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

export async function parseBaplieFile(file: File): Promise<ParsedBaplie> {
  assertUploadSize(file)
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
      const vesselPart = parts[4] ?? ''
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

  for (const seg of segments) {
    if (seg.startsWith('LOC+147+')) {
      const locPart = seg.slice('LOC+147+'.length).replace(/'$/, '')
      slot = locPart.split(':')[0] ?? null
      weight_kg = null
      pol = null
      pod = null
      final_dest = null
      bl_ref = null
      oog_dims = false
      continue
    }

    if (seg.startsWith('MEA+WT++KGM:')) {
      const val = seg.slice('MEA+WT++KGM:'.length).replace(/'$/, '')
      const n = parseFloat(val)
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

    if (seg.startsWith('LOC+6+')) {
      pol = normalizePortCode(extractLocCode(seg))
      continue
    }

    if (seg.startsWith('LOC+12+')) {
      pod = normalizePortCode(extractLocCode(seg))
      continue
    }

    if (seg.startsWith('LOC+83+')) {
      final_dest = normalizePortCode(extractLocCode(seg))
      continue
    }

    if (seg.startsWith('RFF+BM:')) {
      bl_ref = seg.slice('RFF+BM:'.length).replace(/'$/, '') || null
      continue
    }

    if (seg.startsWith('EQD+CN+')) {
      const parts = seg.replace(/'$/, '').split('+')
      const rawNumber = parts[2] ?? ''
      const container_number = rawNumber.replace(/\s+/g, '').toUpperCase()
      const size_type = parts[3] ?? null
      const statusCode = parts[6] ?? ''
      const status: BaplieContainer['status'] = statusCode === '4' ? 'empty' : 'full'

      containers.push({
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

      if (containers.length > 0) {
        const last = containers[containers.length - 1]
        // Only attach if this DGS is in the same block (no LOC+147 yet)
        last.is_imo = true
        last.imo_class = imo_class
        last.un_number = un_number || null
      }
      continue
    }
  }

  const pods = Array.from(new Set(containers.map((c) => c.pod).filter((p): p is string => Boolean(p)))).sort()

  return { vessel_name, voyage_number, containers, pods }
}

function extractLocCode(seg: string): string | null {
  const plusIdx = seg.lastIndexOf('+')
  if (plusIdx === -1) return null
  return seg.slice(plusIdx + 1).replace(/'$/, '').split(':')[0] || null
}
