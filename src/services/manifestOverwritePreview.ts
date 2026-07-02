// Preview de sobrescrita do import de manifesto (#307). Puro: NÃO grava nada.
// Dá transparência antes de confirmar — o import de manifesto faz
// `ON CONFLICT (id) DO UPDATE SET shipper, consignee, cargo_description, pol,
// pod, total_weight_kg, total_cbm ...` (migration 013), sobrescrevendo em
// silêncio B/Ls já existentes (inclusive nascidos de arquivo de B/L). Aqui
// mostramos o diff (de→para) desses campos comerciais antes do apply.
// O apply seletivo por campo (aprovação do operador) é follow-up (migração).

export type ManifestFieldDiff = { field: string; from: string; to: string }
export type ManifestBlOverwrite = { bl_number: string; diffs: ManifestFieldDiff[] }

type OverwriteFields = {
  id: string
  shipper?: string | null
  consignee?: string | null
  cargo_description?: string | null
  pol?: string | null
  pod?: string | null
  total_weight_kg?: number | null
  total_cbm?: number | null
}

const FIELDS: Array<{ key: keyof Omit<OverwriteFields, 'id'>; label: string }> = [
  { key: 'shipper', label: 'Embarcador' },
  { key: 'consignee', label: 'Consignatário' },
  { key: 'cargo_description', label: 'Descrição' },
  { key: 'pol', label: 'POL' },
  { key: 'pod', label: 'POD' },
  { key: 'total_weight_kg', label: 'Peso (kg)' },
  { key: 'total_cbm', label: 'CBM' },
]

function norm(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return String(value)
  return String(value).trim()
}

/**
 * Para cada B/L do manifesto que já existe (mesmo número), lista os campos
 * comerciais que o import mudaria. Ignora campos que o manifesto não traz
 * (`to` vazio) para não sinalizar "apagar por omissão". B/Ls novos não entram.
 */
export function computeManifestOverwriteDiff(
  parsedBls: OverwriteFields[],
  existingBls: OverwriteFields[],
): ManifestBlOverwrite[] {
  const existingById = new Map(existingBls.map((bl) => [bl.id, bl]))
  const result: ManifestBlOverwrite[] = []

  for (const parsed of parsedBls) {
    const existing = existingById.get(parsed.id)
    if (!existing) continue

    const diffs: ManifestFieldDiff[] = []
    for (const field of FIELDS) {
      const from = norm(existing[field.key])
      const to = norm(parsed[field.key])
      if (to !== '' && from.toUpperCase() !== to.toUpperCase()) {
        diffs.push({ field: field.label, from: from || '—', to })
      }
    }
    if (diffs.length) result.push({ bl_number: parsed.id, diffs })
  }

  return result
}
