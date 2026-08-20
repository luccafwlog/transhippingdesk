import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, Pencil } from 'lucide-react'
import { useVoyageTransshipments } from '../../hooks/useTransshipments'
import { Button } from '../ui/Button'
import { formatDate } from '../../lib/utils'
import { formatPortDisplayName } from '../../lib/voyageFormat'
import type { VoyagePolSchedule } from '../../services/voyageRouteSchedules'
import { collectVoyageManifestBatchRows, formatPolDeparture, renderCeCoverage, type VoyageImportBatch } from './voyageCardHelpers'
import type { EditingPolPayload, Voyage } from './voyageCardTypes'

type EstadoMeta = { color: string; bg: string; label: string }

export function VoyageManifestosTab({
  voyage,
  voyageLabel,
  importBatches,
  polSchedules,
  routeCeMasters,
  divergenceCount,
  ceCoverage,
  estadoMeta,
  onEditPol,
}: {
  voyage: Voyage
  voyageLabel: string
  importBatches: VoyageImportBatch[]
  polSchedules: Map<string, VoyagePolSchedule> | undefined
  routeCeMasters: Map<string, string> | undefined
  divergenceCount: number
  ceCoverage: { filled: number; total: number }
  estadoMeta: EstadoMeta
  onEditPol: (payload: EditingPolPayload) => void
}) {
  const navigate = useNavigate()
  const { data: transshipmentData } = useVoyageTransshipments(voyage.id)
  const manifestRows = collectVoyageManifestBatchRows({
    voyageId: voyage.id,
    batches: importBatches,
    bls: voyage.bls,
    polSchedules,
    routeCeMasters,
    omissions: transshipmentData?.omissions,
  })

  return (
    <>
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3"
        style={{ borderColor: estadoMeta.color, backgroundColor: estadoMeta.bg }}
      >
        <div className="flex items-center gap-3 text-sm">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: estadoMeta.color }} />
          <div>
            <div className="font-semibold" style={{ color: estadoMeta.color }}>
              Conciliação: {estadoMeta.label}
            </div>
            <div className="text-xs text-[var(--app-muted)]">
              CE Mercante {ceCoverage.filled}/{ceCoverage.total}
              {divergenceCount ? ` · ${divergenceCount} divergência${divergenceCount === 1 ? '' : 's'} aberta${divergenceCount === 1 ? '' : 's'}` : ''}
            </div>
          </div>
        </div>
        {divergenceCount ? (
          <Button variant="secondary" onClick={() => navigate(`/baplie?voyage=${voyage.id}`)}>
            <AlertTriangle size={15} />
            Resolver divergências
          </Button>
        ) : null}
      </div>

      <div className="app-panel app-panel--padded">
        <div className="mb-3">
          <div className="app-panel__title">Manifestos vinculados</div>
          <div className="app-panel__meta">
            Uma rota por linha: B/Ls vinculados por POL/POD, ATD POL, CE Mercante e CE Master quando houver batch.
          </div>
        </div>

        <div className="app-voyage-table-frame">
          <div className="app-table-scroll">
            <table className="app-table app-table--compact app-table--dense w-full table-fixed text-left text-sm">
              <colgroup>
                <col className="w-[40%]" />
                <col className="w-[12%]" />
                <col className="w-[8%]" />
                <col className="w-[12%]" />
                <col className="w-[12%]" />
                <col className="w-[16%]" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className="px-3 py-2">Rota / Manifesto</th>
                  <th scope="col" className="px-3 py-2">ATD POL</th>
                  <th scope="col" className="px-3 py-2">B/Ls</th>
                  <th scope="col" className="px-3 py-2">CE Merc.</th>
                  <th scope="col" className="px-3 py-2">CE Master</th>
                  <th scope="col" className="px-3 py-2">Ações</th>
                </tr>
              </thead>
              <tbody>
                {manifestRows.length ? (
                  manifestRows.map((row) => {
                    const departure = formatPolDeparture(row.etd, row.atd)
                    return (
                    <tr key={`${voyage.id}-manifest-${row.routeKey}`}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="rounded border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--app-muted)]">
                            {row.modeLabel}
                          </span>
                          <Link
                            className="font-semibold text-[var(--app-blue)] hover:underline"
                            to={`/manifestos?voyage=${voyage.id}&pol=${encodeURIComponent(row.pol)}&pod=${encodeURIComponent(row.pod)}`}
                            aria-label={row.routeLabel}
                          >
                            {row.omission ? (
                              <>
                                <span>{formatPortDisplayName(row.pol)} → </span>
                                <span className="line-through" title={`POD omitido: ${row.omission.omittedPod}`}>
                                  {formatPortDisplayName(row.omission.omittedPod)}
                                </span>
                                <span> → {formatPortDisplayName(row.omission.dischargePod)}</span>
                                <span className="ml-2 rounded border border-[#b45309] bg-[#fff7ed] px-1.5 py-0.5 text-[10px] font-bold text-[#b45309]">
                                  OMISSÃO
                                </span>
                              </>
                            ) : row.routeLabel}
                          </Link>
                        </div>
                      </td>
                      <td className={`px-3 py-2${departure.isActual ? ' text-[var(--app-blue)] font-medium' : ''}`}>{formatDate(departure.value)}</td>
                      <td className="px-3 py-2">{row.blCount}</td>
                      <td className="px-3 py-2">{renderCeCoverage(row.ceFilled, row.ceTotal)}</td>
                      <td className="px-3 py-2">
                        {row.ceMaster ? (
                          <span className="font-mono text-xs text-[var(--app-text-strong)]">{row.ceMaster}</span>
                        ) : row.blCount > 0 ? (
                          <span className="text-xs font-semibold text-[#b45309]" title="Informe o CE Master pelo lápis desta linha">
                            manifesto não informado
                          </span>
                        ) : (
                          <span className="text-[var(--app-muted-soft)]">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <Button
                            variant="secondary"
                            className="app-voyage-icon-btn"
                            aria-label={`Editar ETD previsto + ATD POL e CE Master de ${row.routeLabel}`}
                            title="Editar ETD previsto + ATD POL e CE Master"
                            onClick={() =>
                              onEditPol({
                                voyageId: voyage.id,
                                voyageLabel,
                                pol: row.pol,
                                pod: row.pod,
                                etd: row.etd,
                                atd: row.atd,
                                ceMaster: row.ceMaster,
                                batchIds: row.batchIds,
                              })
                            }
                            disabled={!row.pol || row.pol === '-'}
                          >
                            <Pencil size={15} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="px-3 py-3 text-[var(--app-muted)]">
                      Nenhuma rota de B/L identificada nesta viagem.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

    </>
  )
}
