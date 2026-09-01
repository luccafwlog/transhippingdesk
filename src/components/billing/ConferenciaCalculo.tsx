import { Badge } from '../ui/Badge'
import { useBlLocalChargeLines } from '../../hooks/useLocalCharges'
import { formatBRL, formatUSD } from '../../lib/utils'
import type { LocalChargeLine } from '../../services/charges/chargeOperationsService'
import { applicationBasisLabel, groupChargeLinesByTable, sumChargeLines } from './conferenciaCalculo'

function formatQuantity(value: number | null) {
  const amount = Number(value ?? 0)
  if (!Number.isFinite(amount)) return '-'
  return amount.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}

function lineUnitValue(line: LocalChargeLine) {
  if (line.currency === 'USD' && line.unit_value_usd != null) return formatUSD(line.unit_value_usd)
  return formatBRL(line.unit_value_brl)
}

function lineTotalValue(line: LocalChargeLine) {
  if (line.currency === 'USD' && Number(line.total_value_usd ?? 0) !== 0) return formatUSD(line.total_value_usd)
  return formatBRL(line.total_value_brl)
}

function renderTotal(totalBrl: number, totalUsd: number) {
  return (
    <span className="text-[var(--app-text-strong)]">
      {formatBRL(totalBrl)}
      {totalUsd !== 0 ? <span className="ml-2 text-xs text-[var(--app-muted)]">{formatUSD(totalUsd)}</span> : null}
    </span>
  )
}

// Conferência de cálculo: mostra COMO se chegou ao valor, não só qual é. Cada
// grupo nomeia a tabela de cobrança que produziu suas linhas (migration 369),
// porque a escolha da tabela segue o porto de descarga e é a primeira coisa a
// conferir quando o valor parece errado. Nasce aberta: quem expande o B/L na
// Validação está ali justamente para conferir.
export function ConferenciaCalculo({
  blId,
  financialStatus,
}: {
  blId: string
  financialStatus: string | null
}) {
  const { data, isLoading, isError } = useBlLocalChargeLines(blId)
  const lines = data ?? []
  const groups = groupChargeLinesByTable(lines)
  const total = sumChargeLines(lines)
  const invoiced = financialStatus === 'invoiced'

  return (
    <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <div className="app-metric-tile__label">Conferência de cálculo</div>
        {lines.length > 0 ? <div className="text-sm font-medium">{renderTotal(total.totalBrl, total.totalUsd)}</div> : null}
      </div>
      <div className="mb-3 text-xs text-[var(--app-muted)]">
        {invoiced
          ? 'Linhas que compuseram a fatura emitida.'
          : 'Linhas calculadas para este B/L, pela tabela de cobrança de cada origem.'}
      </div>

      {isLoading ? (
        <div className="text-sm text-[var(--app-muted)]">Carregando linhas de cálculo...</div>
      ) : isError ? (
        <div className="text-sm text-red-600">Falha ao carregar as linhas de cálculo deste B/L.</div>
      ) : lines.length === 0 ? (
        <div className="text-sm text-[var(--app-muted)]">
          Nenhuma linha de taxa calculada para este B/L. Recalcule as taxas para conferir o valor.
        </div>
      ) : (
        <div className="grid gap-4">
          {groups.map((group) => (
            <div key={group.key}>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <div className="whitespace-normal text-sm font-medium text-[var(--app-text-strong)]">
                  {group.title}
                  {group.kind === 'sem_tabela' ? (
                    <Badge tone="red" className="ml-2">
                      Anomalia
                    </Badge>
                  ) : null}
                </div>
                <div className="text-sm">{renderTotal(group.totalBrl, group.totalUsd)}</div>
              </div>
              {group.subtitle ? <div className="mb-2 text-xs text-[var(--app-muted)]">{group.subtitle}</div> : null}
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-[var(--app-muted)]">
                    <th scope="col" className="py-1 pr-3 font-medium">Item</th>
                    <th scope="col" className="py-1 pr-3 font-medium">Qtd.</th>
                    <th scope="col" className="py-1 pr-3 font-medium">Unitário</th>
                    <th scope="col" className="py-1 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {group.lines.map((line) => {
                    const basis = applicationBasisLabel(line.application_basis)
                    return (
                      <tr key={line.id} className="border-t border-[var(--app-border)]">
                        <td className="py-1.5 pr-3">
                          <div className="whitespace-normal text-[var(--app-text-strong)]">{line.charge_name}</div>
                          <div className="whitespace-normal text-xs text-[var(--app-muted)]">
                            {basis ? <span>{basis}</span> : null}
                            {line.override_applied ? <span className="ml-2 text-amber-600">tarifa negociada</span> : null}
                            {line.status === 'review_required' ? (
                              <span className="ml-2 text-amber-600">{line.review_reason ?? 'em revisão'}</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="py-1.5 pr-3 align-top">{formatQuantity(line.quantity)}</td>
                        <td className="py-1.5 pr-3 align-top">{lineUnitValue(line)}</td>
                        <td className="py-1.5 text-right align-top text-[var(--app-text-strong)]">{lineTotalValue(line)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
