import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Boxes, ChevronDown, ChevronUp, Clock, FileText, Gem, Package, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { MetricSection, NavigationCard } from '../shared/VoyageSectionCards'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import { useAuth } from '../../hooks/useAuth'
import { useVoyageTimeline } from '../../hooks/useVoyageTimeline'
import { countDistinctContainerNumbers } from '../../lib/containerCounts'
import { formatDate } from '../../lib/utils'
import { extractErrorText } from '../../lib/errors'
import { formatMetric, formatPortDisplayName, normalizePortName } from '../../lib/voyageFormat'
import {
  buildVoyageTimeline,
  countDistinctRoutes,
  getGraniteModuleStats,
  getVaziosModuleStats,
  splitVoyageBls,
  type VoyageTimelineEvent,
} from '../../services/voyageSummaries'
import { deleteVoyagePodSchedule } from '../../services/voyageRouteSchedules'
import { deleteVoyageExportSchedule, type VoyageExportSchedule } from '../../services/voyageExportSchedules'
import {
  renderCeStatusLabel,
  renderEscalaNumber,
  renderLinkedLabel,
  type VoyageImportBatch,
} from './voyageCardHelpers'
import type { AddingPodPayload, EditingExportPayload, EditingPodPayload, Voyage, VoyagePodRow } from './voyageCardTypes'
import { TransshipmentInfoCard } from './TransshipmentInfoCard'

export function VoyageVisaoTab({
  voyage,
  voyageLabel,
  podRows,
  importBatches,
  exportSchedule,
  isAdmin,
  divergenceCount,
  ceCoverage,
  onAddPod,
  onEditPod,
  onOmitPod,
  onEditExport,
}: {
  voyage: Voyage
  voyageLabel: string
  podRows: VoyagePodRow[]
  importBatches: VoyageImportBatch[]
  exportSchedule: VoyageExportSchedule | null
  isAdmin: boolean
  divergenceCount: number
  ceCoverage: { filled: number; total: number }
  onAddPod: (payload: AddingPodPayload) => void
  onEditPod: (payload: EditingPodPayload) => void
  onOmitPod: (pod: string) => void
  onEditExport: (payload: EditingExportPayload) => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { user } = useAuth()
  const [timelineOpen, setTimelineOpen] = useState(true)

  const { containerBls, breakbulkBls } = splitVoyageBls(voyage.bls)
  // Contagem por rota (par POL/POD), não por arquivo de manifesto (#315).
  const containerManifestCount = countDistinctRoutes(containerBls)
  const breakbulkManifestCount = countDistinctRoutes(breakbulkBls)
  const flatContainers = containerBls.flatMap((bl) => bl.bl_containers ?? [])
  const totalContainers = countDistinctContainerNumbers(flatContainers)
  const totalBreakbulkWeightTon = breakbulkBls.reduce(
    (sum, bl) => sum + Number(bl.bb_weight_ton ?? (bl.total_weight_kg ? Number(bl.total_weight_kg) / 1000 : 0)),
    0,
  )
  const graniteStats = getGraniteModuleStats(voyage.granite_manifests)
  const vaziosStats = getVaziosModuleStats(voyage.vazios_manifests)
  // Rota (POL -> POD) de cada manifesto, derivada dos B/Ls do batch, para
  // identificar o import na linha do tempo pela rota em vez do nome do arquivo.
  const routesByBatchId = useMemo(() => {
    const grouped = new Map<number, Map<string, { pol: string; pod: string; blCount: number }>>()
    for (const bl of voyage.bls ?? []) {
      if (bl.batch_id == null) continue
      const pol = bl.pol?.trim() || '-'
      const pod = bl.pod?.trim() || '-'
      const routes = grouped.get(bl.batch_id) ?? new Map()
      const displayPol = formatPortDisplayName(pol)
      const displayPod = formatPortDisplayName(pod)
      const key = `${displayPol}\u0000${displayPod}`
      const current = routes.get(key)
      routes.set(key, { pol: displayPol, pod: displayPod, blCount: (current?.blCount ?? 0) + 1 })
      grouped.set(bl.batch_id, routes)
    }
    return new Map(Array.from(grouped, ([batchId, routes]) => [batchId, Array.from(routes.values())]))
  }, [voyage.bls])

  const { data: timelineSources } = useVoyageTimeline(voyage.id)
  const timelineEvents = useMemo(
    () =>
      buildVoyageTimeline({
        importBatches: importBatches.map((batch) => ({ ...batch, routes: routesByBatchId.get(batch.id) })),
        scheduleEvents: timelineSources?.scheduleEvents,
        auditEvents: timelineSources?.auditEvents,
        resolutions: timelineSources?.resolutions,
        baplieImports: timelineSources?.baplieImports,
        openDivergenceCount: divergenceCount,
        voyageStatus: voyage.status,
        ceCoverage,
        actorNames: timelineSources?.actorNames,
      }),
    [ceCoverage, divergenceCount, importBatches, routesByBatchId, timelineSources, voyage.status],
  )

  async function handleDeletePod(row: VoyagePodRow) {
    const routeBls = (voyage.bls ?? []).filter((bl) => normalizePortName(bl.pod) === normalizePortName(row.pod))
    const hasScheduleData = Boolean(row.eta || row.etb || row.ata || row.atb || row.etd || row.atd || row.rtw !== null)
    if (routeBls.length > 0) {
      showToast('Não é possível excluir este POD: existem B/Ls vinculados.', 'error')
      return
    }
    if (!hasScheduleData && row.linked !== true) {
      showToast('Este POD ja nao possui dados planejados para remover.', 'info')
      return
    }
    if (!user?.id) {
      showToast('Sessao expirada. Entre novamente para registrar a auditoria.', 'error')
      return
    }
    const confirmed = await confirm({
      title: 'Excluir planejamento do POD',
      message: `Excluir o planejamento do POD ${row.pod}? As datas e o vínculo operacional serão removidos.`,
      confirmLabel: 'Excluir',
      tone: 'danger',
    })
    if (!confirmed) return
    try {
      await deleteVoyagePodSchedule({ voyageId: voyage.id, pod: row.pod, changedBy: user.id })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['voyage-pod-schedules'] }),
        queryClient.invalidateQueries({ queryKey: ['voyage-timeline'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] }),
      ])
      showToast('POD removido do planejamento.', 'success')
    } catch (error) {
      const errorText = extractErrorText(error).toLowerCase()
      if (errorText.includes('42501') || errorText.includes('permission denied')) {
        showToast('Sem permissão para excluir planejamento do POD. Solicite acesso administrativo.', 'error')
        return
      }
      showToast(`Falha ao excluir planejamento do POD.${errorText ? ` Motivo: ${errorText}` : ''}`, 'error')
    }
  }

  async function handleDeleteExport(schedule: VoyageExportSchedule) {
    const confirmed = await confirm({
      title: 'Excluir planejamento do POL',
      message: `Excluir o planejamento de exportação do POL ${schedule.pol ?? '-'}?`,
      confirmLabel: 'Excluir',
      tone: 'danger',
    })
    if (!confirmed) return
    try {
      await deleteVoyageExportSchedule(schedule.id)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['voyage-export-schedules'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] }),
      ])
      showToast('Planejamento de exportação removido.', 'success')
    } catch {
      showToast('Falha ao remover planejamento de exportação.', 'error')
    }
  }

  const planningContent = (
    <MetricSection
      title="Planejamento por POD/POL"
      compact
      actions={isAdmin ? (
        <>
          <Button variant="secondary" className="app-btn--sm" onClick={() => onAddPod({ voyageId: voyage.id, voyageLabel })}>
            <Plus size={15} />
            Adicionar POD
          </Button>
          <Button
            variant="secondary"
            className="app-btn--sm"
            onClick={() => onEditExport({ voyageId: voyage.id, voyageLabel, existing: exportSchedule })}
          >
            <Plus size={15} />
            Adicionar POL
          </Button>
        </>
      ) : undefined}
    >
      <div className="app-voyage-table-frame">
        <div className="app-table-scroll">
          <table className="app-table app-table--compact app-table--dense app-table--sticky-actions w-full text-left text-sm">
            <colgroup>
              <col className="min-w-[90px]" />
              <col className="min-w-[80px]" />
              <col className="min-w-[80px]" />
              <col className="min-w-[80px]" />
              <col className="min-w-[80px]" />
              <col className="min-w-[80px]" />
              <col className="min-w-[80px]" />
              <col className="min-w-[70px]" />
              <col className="min-w-[90px]" />
              <col className="min-w-[100px]" />
              <col className="min-w-[90px]" />
              <col className="w-[1%] whitespace-nowrap" />
            </colgroup>
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2">POD/POL</th>
              <th scope="col" className="px-3 py-2">ETA</th>
              <th scope="col" className="px-3 py-2">ETB</th>
              <th scope="col" className="px-3 py-2">ATA</th>
              <th scope="col" className="px-3 py-2">ATB</th>
              <th scope="col" className="px-3 py-2">ETD</th>
              <th scope="col" className="px-3 py-2">ATD</th>
              <th scope="col" className="px-3 py-2">RESTOW</th>
              <th scope="col" className="px-3 py-2">BLs e CEs</th>
              <th scope="col" className="px-3 py-2">Nº Escala</th>
              <th scope="col" className="px-3 py-2">VINCULADA</th>
              <th scope="col" className="px-3 py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {podRows.length ? (
              podRows.map((row) => (
                <tr key={`${voyage.id}-lineup-${row.pod}`}>
                  <td className="px-3 py-2 font-semibold text-[var(--app-text-strong)]">{row.pod}</td>
                  <td className="px-3 py-2">{formatDate(row.eta)}</td>
                  <td className="px-3 py-2">{formatDate(row.etb)}</td>
                  <td className="px-3 py-2">{formatDate(row.ata)}</td>
                  <td className="px-3 py-2">{formatDate(row.atb)}</td>
                  <td className="px-3 py-2">{formatDate(row.etd)}</td>
                  <td className="px-3 py-2">{formatDate(row.atd)}</td>
                  <td className="px-3 py-2">{row.rtw === null ? '-' : formatMetric(row.rtw)}</td>
                  <td className="px-3 py-2">{renderCeStatusLabel(row.ceStatus)}</td>
                  <td className="px-3 py-2">{renderEscalaNumber(row.escalaNumber)}</td>
                  <td className="px-3 py-2">{renderLinkedLabel(row.linked)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        className="app-voyage-icon-btn"
                        aria-label={`Editar planejamento do POD ${row.pod}`}
                        onClick={() =>
                          onEditPod({
                            voyageId: voyage.id,
                            voyageLabel,
                            pod: row.pod,
                            eta: row.eta,
                            etb: row.etb,
                            ata: row.ata,
                            atb: row.atb,
                            etd: row.etd,
                            atd: row.atd,
                            rtw: row.rtw,
                            ceStatus: row.ceStatus,
                            linked: row.linked,
                            escalaNumber: row.escalaNumber,
                          })
                        }
                      >
                        <Pencil size={15} />
                      </Button>
                      {isAdmin ? (
                        <>
                          {!row.omitted ? (
                            <Button
                              variant="secondary"
                              className="app-voyage-icon-btn"
                              aria-label={`Omitir escala do POD ${row.pod}`}
                              title={`Omitir escala do POD ${row.pod}`}
                              onClick={() => onOmitPod(row.pod)}
                            >
                              <AlertTriangle size={15} />
                            </Button>
                          ) : null}
                          <Button
                            variant="danger"
                            className="app-voyage-icon-btn"
                            aria-label={`Excluir planejamento do POD ${row.pod}`}
                            onClick={() => handleDeletePod(row)}
                          >
                            <Trash2 size={15} />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={12} className="px-3 py-3 text-[var(--app-muted)]">
                  Nenhum POD planejado para esta viagem.
                </td>
              </tr>
            )}
            {exportSchedule ? (
              <tr className="border-t border-[var(--app-border)] bg-[var(--app-gold-soft)]">
                <td className="px-3 py-2 font-semibold text-[var(--app-text-strong)]">
                  {exportSchedule.pol ?? 'POL'}
                  <Badge tone="yellow" className="ml-1 align-middle">EXP</Badge>
                </td>
                <td className="px-3 py-2">{formatDate(exportSchedule.eta)}</td>
                <td className="px-3 py-2">{formatDate(exportSchedule.etb)}</td>
                <td colSpan={3} className="px-3 py-2 text-[var(--app-muted)] text-xs">
                  {[
                    exportSchedule.hasGranite ? 'GRANITE' : null,
                    exportSchedule.containersQty !== null
                      ? `${exportSchedule.containersQty} CNTRS${exportSchedule.movementsQty !== null ? ` - ${exportSchedule.movementsQty} MOVES` : ''}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' | ') || '—'}
                </td>
                <td className="px-3 py-2">{renderCeStatusLabel(exportSchedule.ceStatus ?? 'waiting')}</td>
                <td className="px-3 py-2">{renderLinkedLabel(exportSchedule.linked)}</td>
                <td className="px-3 py-2">-</td>
                <td className="px-3 py-2">
                  {isAdmin ? (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        className="app-voyage-icon-btn"
                        aria-label="Editar POL de exportação"
                        onClick={() => onEditExport({ voyageId: voyage.id, voyageLabel, existing: exportSchedule })}
                      >
                        <Pencil size={15} />
                      </Button>
                      <Button
                        variant="danger"
                        className="app-voyage-icon-btn"
                        aria-label="Excluir POL de exportação"
                        onClick={() => handleDeleteExport(exportSchedule)}
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        </div>
      </div>
    </MetricSection>
  )

  const navCardsContent = (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <NavigationCard
        icon={Boxes}
        title="Manifestos CNTR"
        metrics={[`${containerManifestCount} manifestos`, `${containerBls.length} B/Ls`, `${totalContainers} containers distintos`]}
        onClick={() => navigate(`/manifestos?voyage=${voyage.id}`)}
        disabled={containerBls.length === 0}
      />
      <NavigationCard
        icon={FileText}
        title="Manifestos BB"
        metrics={[`${breakbulkManifestCount} manifestos`, `${breakbulkBls.length} B/Ls`, `${formatMetric(totalBreakbulkWeightTon)} ton`]}
        onClick={() => navigate(`/carga-solta?voyage=${voyage.id}`)}
        disabled={breakbulkBls.length === 0}
      />
      <NavigationCard
        icon={Gem}
        title="Granito"
        metrics={[`${graniteStats.totalManifests} manifestos`, `${formatMetric(graniteStats.totalWeightTon)} ton`, `${graniteStats.totalBls} B/Ls`]}
        onClick={() => navigate(`/granito?voyage=${voyage.id}`)}
        disabled={graniteStats.totalManifests === 0}
      />
      <NavigationCard
        icon={Package}
        title="Vazios"
        metrics={[`${vaziosStats.totalBookings} bookings`, `${vaziosStats.distinctContainers} containers`, vaziosStats.destinations || 'Sem destinos']}
        onClick={() => navigate(`/vazios?voyage=${voyage.id}`)}
        disabled={vaziosStats.totalManifests === 0}
      />
    </section>
  )

  return (
    <div className="grid gap-4">
      <TransshipmentInfoCard voyageId={voyage.id} />
      {planningContent}
      {navCardsContent}
      <VoyageTimeline events={timelineEvents} open={timelineOpen} onToggle={() => setTimelineOpen((value) => !value)} />
    </div>
  )
}

const TIMELINE_DOT: Record<VoyageTimelineEvent['kind'], string> = {
  import: '#2a9d63',
  'baplie-import': '#0f766e',
  'escala-date': '#1d4d88',
  'escala-number': '#b8860b',
  'manifestos-linked': '#2563a8',
  'ce-status': '#7c3aed',
  restow: '#d97706',
  'pod-added': '#2a9d63',
  'divergence-resolved': '#1f7a4d',
  'divergence-opened': '#b45309',
  'pod-removed': '#cf4b3f',
  'voyage-completed': '#1f7a4d',
  'ce-master': '#5b5fc7',
  'voyage-data': '#64748b',
  'ce-coverage': '#15803d',
  omission: '#dc2626',
  'transshipment-info': '#0f766e',
}

function formatTimelineMoment(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return formatDate(value)
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function VoyageTimeline({
  events,
  open,
  onToggle,
}: {
  events: VoyageTimelineEvent[]
  open: boolean
  onToggle: () => void
}) {
  return (
    <section className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-[var(--app-muted)]">
          <Clock size={16} />
          Linha do tempo
        </span>
        {open ? (
          <ChevronUp size={18} className="text-[var(--app-muted)]" />
        ) : (
          <ChevronDown size={18} className="text-[var(--app-muted)]" />
        )}
      </button>
      {open ? (
        events.length ? (
          <ol className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {events.map((event) => (
              <li
                key={event.id}
                className="relative overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-3 pl-4"
              >
                <span
                  className="absolute left-0 top-0 h-full w-1"
                  style={{ backgroundColor: TIMELINE_DOT[event.kind] }}
                />
                <div className="text-xs text-[var(--app-muted-soft)]">{formatTimelineMoment(event.at)}</div>
                <div className="mt-0.5 text-sm font-semibold text-[var(--app-text)]">{event.title}</div>
                <div className="mt-0.5 text-sm leading-snug text-[var(--app-muted)]">{event.detail}</div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="mt-3 text-sm text-[var(--app-muted)]">Sem eventos registrados ainda.</div>
        )
      ) : null}
    </section>
  )
}
