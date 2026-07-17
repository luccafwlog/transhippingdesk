// Spec §12–§13: estado operacional derivado de fatos, nunca status manual.

export type EscalaState = 'atracada' | 'concluida'

export function deriveEscalaState(input: { atb: string | null; atd: string | null }): EscalaState | null {
  if (input.atd) return 'concluida'
  if (input.atb) return 'atracada'
  return null
}

/** Coluna intitulada ETA: com ATA mostra a data real (verde); removida a ATA, volta ao ETA. */
export function arrivalDisplay(input: { eta: string | null; ata: string | null }) {
  return input.ata
    ? { value: input.ata, isActual: true as const }
    : { value: input.eta, isActual: false as const }
}
