import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Download, Pencil } from 'lucide-react'
import { Button } from '../ui/Button'
import { formatDate } from '../../lib/utils'
import type { VoyagePolSchedule } from '../../services/voyageRouteSchedules'
import { collectVoyageManifestBatchRows, renderCeCoverage, type VoyageImportBatch } from './voyageCardHelpers'
import type { EditingPolPayload, Voyage } from './voyageCardTypes'
import { MercanteEdiModal } from '../shared/MercanteEdiModal'

type EstadoMeta = { color: string; bg: string; label: string }

export function VoyageManifestosTab({
  voyage,
  voyageLabel,
  importBatches,
  polSchedules,
  divergenceCount,
  ceCoverage,
  estadoMeta,
  onEditPol,
}: {
  voyage: Voyage
  voyageLabel: string
  importBatches: VoyageImportBatch[]
  polSchedules: Map<string, VoyagePolSchedule> | undefined
  divergenceCount: number
  ceCoverage: { filled: number; total: number }
  estadoMeta: EstadoMeta
  onEditPol: (payload: EditingPolPayload) => void
}) {
  const navigate = useNavigate()
  const [ediModalOpen, setEdiModalOpen] = useState(false)
  const [ediModalPol, setEdiModalPol] = useState<string>('')
  const [ediModalPod, setEdiModalPod] = useState<string>('')

  const manifestRows = collectVoyageManifestBatchRows({
    voyageId: voyage.id,
    batches: importBatches,
    bls: voyage.bls,
    polSchedules,
  })

  const ediModalBls = useMemo(() => {
    if (!ediModalOpen) return []
    return (voyage.bls ?? []).filter(
      (bl) => bl.pol?.trim() === ediModalPol && bl.pod?.trim() === ediModalPod,
    )
  }, [voyage.bls, ediModalPol, ediModalPod, ediModalOpen])

  function handleOpenEdiModal(routeKey: string) {
    const [pol, pod] = routeKey.split('__')
    setEdiModalPol(pol ?? '')
    setEdiModalPod(pod ?? '')
    setEdiModalOpen(true)
  }

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
            Uma rota por linha: B/Ls vinculados por POL/POD, ETD por POL, CE Mercante e CE Master quando houver batch.
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
                  <th scope="col" className="px-3 py-2">ETD</th>
                  <th scope="col" className="px-3 py-2">B/Ls</th>
                  <th scope="col" className="px-3 py-2">CE Merc.</th>
                  <th scope="col" className="px-3 py-2">CE Master</th>
                  <th scope="col" className="px-3 py-2">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {manifestRows.length ? (
                  manifestRows.map((row) => (
                    <tr key={`${voyage.id}-manifest-${row.routeKey}`}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="rounded border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--app-muted)]">
                            {row.modeLabel}
                          </span>
                          <span className="font-semibold text-[var(--app-text-strong)]">{row.routeLabel}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-[var(--app-muted)]">{row.filenames.join(' · ')}</div>
                      </td>
                      <td className="px-3 py-2">{formatDate(row.etd)}</td>
                      <td className="px-3 py-2">{row.blCount}</td>
                      <td className="px-3 py-2">{renderCeCoverage(row.ceFilled, row.ceTotal)}</td>
                      <td className="px-3 py-2">
                        {row.ceMaster ? (
                          <span className="font-mono text-xs text-[var(--app-text-strong)]">{row.ceMaster}</span>
                        ) : (
                          <span className="text-[var(--app-muted-soft)]">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <Button
                            variant="secondary"
                            className="app-voyage-icon-btn"
                            aria-label={`Gerar EDI Mercante de ${row.routeLabel}`}
                            title="Gerar EDI Mercante"
                            onClick={() => handleOpenEdiModal(row.routeKey)}
                            disabled={!row.pol || row.pol === '-'}
                          >
                            <Download size={15} />
                          </Button>
                          <Button
                            variant="secondary"
                            className="app-voyage-icon-btn"
                            aria-label={`${row.batchIds.length ? 'Editar ETD e CE Master' : 'Editar ETD'} de ${row.routeLabel}`}
                            title={row.batchIds.length ? 'Editar ETD e CE Master' : 'Editar ETD'}
                            onClick={() =>
                              onEditPol({
                                voyageId: voyage.id,
                                voyageLabel,
                                pol: row.pol,
                                etd: row.etd,
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
                  ))
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

      <MercanteEdiModal
        open={ediModalOpen}
        onClose={() => setEdiModalOpen(false)}
        voyage={voyage}
        bls={ediModalBls}
        prefilledPol={ediModalPol}
        prefilledPod={ediModalPod}
      />
    </>
  )
}
