import { formatPortDisplayName } from '../../lib/voyageFormat'
import type { LocalChargeLine } from '../../services/charges/chargeOperationsService'

export type ConferenceGroupKind = 'tabela' | 'manual' | 'sem_tabela'

export type ConferenceGroup = {
  key: string
  kind: ConferenceGroupKind
  title: string
  subtitle: string | null
  lines: LocalChargeLine[]
  totalBrl: number
  totalUsd: number
}

function toAmount(value: number | string | null | undefined) {
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) ? amount : 0
}

// O agrupamento responde à pergunta que a expansão precisa responder: de onde
// veio cada valor. Três origens possíveis, nesta ordem de leitura:
//
//   `tabela`     — cálculo automático a partir de uma tabela de cobrança
//                  cadastrada (a de Vitória para quem descarrega em Vitória);
//   `manual`     — linha lançada à mão, que não sai de tabela nenhuma;
//   `sem_tabela` — anomalia: linha automática sem tabela vinculada. Não é um
//                  estado esperado, e some da conferência se for tratada como
//                  as demais — por isso ganha grupo próprio em vez de cair no
//                  balaio de "outras".
export function groupChargeLinesByTable(lines: LocalChargeLine[]): ConferenceGroup[] {
  const groups = new Map<string, ConferenceGroup>()

  for (const line of lines) {
    const isManual = line.source === 'manual'
    const hasTable = line.charge_table_id != null
    const kind: ConferenceGroupKind = isManual ? 'manual' : hasTable ? 'tabela' : 'sem_tabela'
    const key = kind === 'tabela' ? `tabela:${line.charge_table_id}` : kind

    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        kind,
        title: groupTitle(kind, line),
        subtitle: groupSubtitle(kind, line),
        lines: [],
        totalBrl: 0,
        totalUsd: 0,
      }
      groups.set(key, group)
    }

    group.lines.push(line)
    group.totalBrl += toAmount(line.total_value_brl)
    group.totalUsd += toAmount(line.total_value_usd)
  }

  const order: Record<ConferenceGroupKind, number> = { tabela: 0, manual: 1, sem_tabela: 2 }
  return [...groups.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.title.localeCompare(b.title, 'pt-BR'))
}

function groupTitle(kind: ConferenceGroupKind, line: LocalChargeLine) {
  if (kind === 'manual') return 'Lançamentos manuais'
  if (kind === 'sem_tabela') return 'Sem tabela vinculada'
  return line.charge_table_name?.trim() || `Tabela #${line.charge_table_id}`
}

function groupSubtitle(kind: ConferenceGroupKind, line: LocalChargeLine) {
  if (kind === 'manual') return 'Fora de tabela: valor digitado na operação.'
  if (kind === 'sem_tabela') return 'Linha automática sem tabela de cobrança vinculada — recalcule para reconciliar.'
  const pod = line.charge_table_pod?.trim()
  return pod ? `Descarga em ${formatPortDisplayName(pod)}` : null
}

// A base de aplicação explica a quantidade ("por container", "por tonelada").
// Vem do cadastro do item e chega crua; o rótulo só a torna legível, sem
// inventar significado para valores que o cadastro ainda não conhece. O
// vocabulário é o mesmo do CHECK de charge_table_items (migration 016) e do
// motor de cálculo (274): 'bl', 'container_distinct_voyage', 'weight_ton',
// 'teu' — não os per_* que a UI tinha inventado.
const APPLICATION_BASIS_LABEL: Record<string, string> = {
  bl: 'por B/L',
  container_distinct_voyage: 'por container',
  weight_ton: 'por tonelada',
  teu: 'por TEU',
}

export function applicationBasisLabel(basis: string | null | undefined) {
  const key = (basis ?? '').trim().toLowerCase()
  if (!key) return null
  return APPLICATION_BASIS_LABEL[key] ?? key.replace(/_/g, ' ')
}

export function sumChargeLines(lines: LocalChargeLine[]) {
  return lines.reduce(
    (acc, line) => ({
      totalBrl: acc.totalBrl + toAmount(line.total_value_brl),
      totalUsd: acc.totalUsd + toAmount(line.total_value_usd),
    }),
    { totalBrl: 0, totalUsd: 0 },
  )
}
