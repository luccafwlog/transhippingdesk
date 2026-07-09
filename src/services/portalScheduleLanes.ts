import { normalizePortCode } from './portCode'

export type PortalScheduleLaneKind = 'pol' | 'pod'

export type PortalScheduleLane = {
  /** Nome exibido na coluna e no rotulo do campo. */
  label: string
  /** POL = origem (ETD); POD = destino (ETA). */
  kind: PortalScheduleLaneKind
}

// Rota do servico CSSC ECSA, na ordem das colunas do quadro do Portal.
// Fonte unica consumida por widget do Portal, Chegadas e Saidas e upload.
export const PORTAL_SCHEDULE_LANES: readonly PortalScheduleLane[] = [
  { label: 'QINGDAO', kind: 'pol' },
  { label: 'SHANGHAI', kind: 'pol' },
  { label: 'TAICANG', kind: 'pol' },
  { label: 'NINGBO', kind: 'pol' },
  { label: 'NANSHA', kind: 'pol' },
  { label: 'SALVADOR', kind: 'pod' },
  { label: 'VITÓRIA', kind: 'pod' },
  { label: 'PECÉM', kind: 'pod' },
]

/** Code canonico do lane (chave dos POL/POD schedules da viagem). */
export function portalLaneCode(lane: PortalScheduleLane): string {
  return normalizePortCode(lane.label) ?? lane.label.toUpperCase()
}
