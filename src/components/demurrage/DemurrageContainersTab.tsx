import { Link } from 'react-router-dom'
import { Clock, FileText, Pencil } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card, EmptyState, InlineError } from '../ui/Card'
import { Field, Input } from '../ui/Input'
import { DemurrageStatusBadge } from './DemurrageBadges'
import { effectiveDemurrage, fmtUSD } from '../../services/demurrage/demurragePresentation'
import { formatResultCount } from '../../lib/operationalState'
import { formatDate } from '../../lib/utils'
import { extractErrorText } from '../../lib/errors'
import type { DemurrageContainerListItem } from '../../types/database'

type Props = {
  search: string
  filtered: DemurrageContainerListItem[]
  grouped: Map<string, DemurrageContainerListItem[]>
  filterDescription: string
  loading: boolean
  error: unknown
  generatingBl: string | null
  onSearchChange: (value: string) => void
  onGenerateInvoice: (blId: string) => void
  onEditContainer: (container: DemurrageContainerListItem) => void
}

export function DemurrageContainersTab({
  search,
  filtered,
  grouped,
  filterDescription,
  loading,
  error,
  generatingBl,
  onSearchChange,
  onGenerateInvoice,
  onEditContainer,
}: Props) {
  return (
    <>
      <Card className="mb-4 p-4">
        <Field label="Buscar">
          <Input placeholder="Container, BL ou cliente..." value={search} onChange={(event) => onSearchChange(event.target.value)} />
        </Field>
      </Card>

      {loading && <Card>Carregando...</Card>}
      {error && <InlineError message={`Erro ao carregar containers: ${extractErrorText(error)}`} />}

      <div className="mb-3 flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span className="font-semibold text-white">{formatResultCount(filtered.length, 'container visível', 'containers visíveis')}</span>
        <span className="text-xs text-slate-400">{filterDescription}</span>
      </div>

      {!loading && !error && grouped.size === 0 && (
        <EmptyState icon={Clock} title="Nenhum container em demurrage" description="Nenhum container fora do free time (ainda fora ou devolvido com sobreestadia)." />
      )}

      {grouped.size > 0 ? (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="app-table app-table--compact min-w-[1100px] text-left text-sm">
              <thead className="bg-[#0d1117] text-xs uppercase text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2">Container</th>
                  <th scope="col" className="py-2">Tipo</th>
                  <th scope="col" className="py-2">Descarga</th>
                  <th scope="col" className="py-2">Devolução</th>
                  <th scope="col" className="py-2">Free time</th>
                  <th scope="col" className="py-2">Dias excedidos</th>
                  <th scope="col" className="py-2">P1 / P2</th>
                  <th scope="col" className="py-2">Status</th>
                  <th scope="col" className="py-2">USD</th>
                  <th scope="col" className="py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]">
                {Array.from(grouped.entries()).flatMap(([blId, blContainers]) => {
                  const firstBl = blContainers[0].bl as { customer?: { name?: string } | null; voyage?: { voyage_number?: string; vessel?: { name?: string } | null } | null } | null
                  const customerName = firstBl?.customer?.name ?? blId
                  const voyageInfo = firstBl?.voyage?.voyage_number ? `${firstBl.voyage.voyage_number} — ${firstBl.voyage.vessel?.name ?? ''}` : ''
                  const hasOverdue = blContainers.some((container) => container.demurrage_status === 'overdue')
                  const blTotalUSD = blContainers.reduce((sum, container) => sum + (effectiveDemurrage(container)?.total_usd ?? 0), 0)

                  return [
                    <tr key={`${blId}-header`} className="bg-[var(--app-surface-muted)]">
                      <td colSpan={10} className="px-4 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <Link to={`/manifestos/${blId}`} className="font-semibold text-blue-400 hover:underline">{blId}</Link>
                            <span className="text-sm text-slate-400">{customerName}</span>
                            {voyageInfo && <span className="text-xs text-slate-500">{voyageInfo}</span>}
                          </div>
                          <div className="flex items-center gap-3">
                            {blTotalUSD > 0 && <span className="text-sm font-semibold text-amber-400">{fmtUSD(blTotalUSD)}</span>}
                            {hasOverdue && (
                              <Button variant="secondary" disabled={generatingBl === blId} onClick={() => onGenerateInvoice(blId)}>
                                <FileText size={14} />
                                {generatingBl === blId ? 'Gerando...' : 'Gerar Fatura'}
                              </Button>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>,
                    ...blContainers.map((container) => {
                      const calc = effectiveDemurrage(container)
                      const excessDays = calc ? Math.max(0, calc.total_days - calc.free_days) : 0
                      return (
                        <tr key={container.id}>
                          <td className="px-4 py-2 font-semibold text-white">{container.container_number}</td>
                          <td className="py-2">{container.type ?? '-'}</td>
                          <td className="py-2">{container.discharge_date ? formatDate(container.discharge_date) : '—'}</td>
                          <td className="py-2">{container.return_date ? formatDate(container.return_date) : <span className="text-slate-500">Pendente</span>}</td>
                          <td className="py-2">{calc ? calc.free_days : '—'}</td>
                          <td className="py-2">{calc ? excessDays : '—'}</td>
                          <td className="py-2 text-slate-400">{calc ? `${calc.days_p1} / ${calc.days_p2}` : '—'}</td>
                          <td className="py-2"><DemurrageStatusBadge status={container.demurrage_status} /></td>
                          <td className="py-2 font-semibold text-amber-400">{calc && calc.total_usd > 0 ? fmtUSD(calc.total_usd) : '—'}</td>
                          <td className="py-2">
                            <button
                              type="button"
                              className="rounded p-1 text-slate-500 transition-colors hover:text-slate-200"
                              title="Editar datas"
                              onClick={() => onEditContainer(container)}
                            >
                              <Pencil size={14} />
                            </button>
                          </td>
                        </tr>
                      )
                    }),
                  ]
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </>
  )
}
