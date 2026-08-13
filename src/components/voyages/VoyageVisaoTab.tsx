import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, ChevronUp, Clock, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { MetricSection } from '../shared/VoyageSectionCards'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import { useAuth } from '../../hooks/useAuth'
import { useVoyageTimeline } from '../../hooks/useVoyageTimeline'
import { formatDate } from '../../lib/utils'
import { classifyDbError } from '../../lib/errors'
import { formatMetric, normalizePortName } from '../../lib/voyageFormat'
import { normalizePortCode } from '../../services/portCode'
import {
  buildVoyageTimeline,
  groupBlsByRoute,
  type VoyageTimelineEvent,
} from '../../services/voyageSummaries'
import { deleteVoyagePodSchedule, type VoyageEscalaDivergence, type VoyageEscalaSchedule } from '../../services/voyageRouteSchedules'
import { deleteVoyageExportSchedule, type VoyageExportSchedule } from '../../services/voyageExportSchedules'
import { listVaziosExportEmbarkPorts } from '../../services/vaziosExportOperations'
import { queryKeys } from '../../services/queryKeys'
import { afterEscalaAlterada } from '../../services/cacheEffects'
import {
  renderCeStatusLabel,
  renderEscalaNumber,
  renderLinkedLabel,
  type VoyageImportBatch,
} from './voyageCardHelpers'
import type { Voyage } from './voyageCardTypes'
import type { EscalaModalData } from '../shared/VoyageScheduleModals'
import { TransshipmentInfoCard } from './TransshipmentInfoCard'

export function VoyageVisaoTab({
  voyage,
  voyageLabel,
  escalaRows,
  importBatches,
  exportSchedules,
  isAdmin,
  divergenceCount,
  ceCoverage,
  onEditEscala,
  onOmitPod,
}: {
  voyage: Voyage
  voyageLabel: string
  escalaRows: VoyageEscalaSchedule[]
  importBatches: VoyageImportBatch[]
  exportSchedules: VoyageExportSchedule[]
  isAdmin: boolean
  divergenceCount: number
  ceCoverage: { filled: number; total: number }
  onEditEscala: (payload: EscalaModalData) => void
  onOmitPod: (pod: string) => void
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { user, can } = useAuth()
  const canEditVoyages = can('voyages_edit')
  const [timelineOpen, setTimelineOpen] = useState(true)

  // Rota (POL -> POD) de cada manifesto, derivada dos B/Ls do batch, para
  // identificar o import na linha do tempo pela rota em vez do nome do arquivo.
  const routesByBatchId = useMemo(() => groupBlsByRoute(voyage.bls), [voyage.bls])

  const { data: timelineSources } = useVoyageTimeline(voyage.id)
  const timelineEvents = useMemo(
    () =>
      buildVoyageTimeline({
        importBatches: (timelineSources?.importBatches ?? importBatches).map((batch) => ({ ...batch, routes: routesByBatchId.get(batch.id) })),
        scheduleEvents: timelineSources?.scheduleEvents,
        auditEvents: timelineSources?.auditEvents,
        resolutions: timelineSources?.resolutions,
        baplieImports: timelineSources?.baplieImports,
        openDivergenceCount: divergenceCount,
        voyageStatus: voyage.status,
        ceCoverage,
        actorNames: timelineSources?.actorNames,
        actorDepartments: timelineSources?.actorDepartments,
      }),
    [ceCoverage, divergenceCount, importBatches, routesByBatchId, timelineSources, voyage.status],
  )

  const exportScheduleByPort = useMemo(() => {
    const byPort = new Map<string, VoyageExportSchedule>()
    for (const schedule of exportSchedules) {
      byPort.set(normalizePortCode(schedule.pol) ?? normalizePortName(schedule.pol), schedule)
    }
    return byPort
  }, [exportSchedules])

  // Embarque de Vazios é (viagem, porto): a lista de portos diz em qual escala
  // existe carga de exportação registrada.
  const { data: vaziosExportPorts } = useQuery({
    queryKey: queryKeys.voyages.vaziosExportPorts(voyage.id),
    queryFn: () => listVaziosExportEmbarkPorts(voyage.id),
  })

  // A declaração de exportação não pode ser retirada de uma escala que já tem
  // carga: granito pelo porto de carregamento do manifesto, vazios pelo porto
  // de embarque da operação.
  const portsWithExportCargo = useMemo(() => {
    const ports = new Set<string>()
    for (const manifest of voyage.granite_manifests ?? []) {
      const normalized = normalizePortCode(manifest.loading_port)
      if (normalized) ports.add(normalized)
    }
    for (const port of vaziosExportPorts ?? []) ports.add(port)
    return ports
  }, [voyage.granite_manifests, vaziosExportPorts])

  function buildEscalaModalData(row: VoyageEscalaSchedule | null): EscalaModalData {
    const exportSchedule = row
      ? exportScheduleByPort.get(normalizePortCode(row.port) ?? normalizePortName(row.port)) ?? null
      : null
    return {
      voyageId: voyage.id,
      voyageLabel,
      port: row?.port ?? null,
      temImportacao: row?.temImportacao ?? false,
      eta: row?.eta ?? null,
      etb: row?.etb ?? null,
      ata: row?.ata ?? null,
      atb: row?.atb ?? null,
      etd: row?.etd ?? null,
      atd: row?.atd ?? null,
      rtw: row?.rtw ?? null,
      ceStatus: (row?.podCeStatus ?? row?.ceStatus ?? null) as EscalaModalData['ceStatus'],
      linked: row?.linked ?? null,
      escalaNumber: row?.escalaNumber ?? null,
      exportExistingId: exportSchedule?.id ?? null,
      temExportacao: exportSchedule?.temExportacao ?? false,
      hasGranite: exportSchedule?.hasGranite ?? false,
      containersQty: exportSchedule?.containersQty ?? null,
      movementsQty: exportSchedule?.movementsQty ?? null,
      dischargePorts: exportSchedule?.dischargePorts ?? [],
      exportLocked: row ? portsWithExportCargo.has(normalizePortCode(row.port) ?? normalizePortName(row.port)) : false,
    }
  }

  // Uma escala, uma exclusão: o portador das datas e a linha de exportação do
  // mesmo porto saem juntos.
  async function handleDeleteEscala(row: VoyageEscalaSchedule) {
    const exportSchedule = exportScheduleByPort.get(normalizePortCode(row.port) ?? normalizePortName(row.port)) ?? null
    const routeBls = (voyage.bls ?? []).filter((bl) => (normalizePortCode(bl.pod) ?? normalizePortName(bl.pod)) === (normalizePortCode(row.port) ?? normalizePortName(row.port)))
    const hasScheduleData = Boolean(row.eta || row.etb || row.ata || row.atb || row.etd || row.atd || row.rtw !== null)
    if (routeBls.length > 0) {
      showToast('Não é possível excluir esta escala: existem B/Ls vinculados.', 'error')
      return
    }
    if (!hasScheduleData && row.linked !== true && !exportSchedule) {
      showToast('Esta escala ja nao possui dados planejados para remover.', 'info')
      return
    }
    if (!user?.id) {
      showToast('Sessao expirada. Entre novamente para registrar a auditoria.', 'error')
      return
    }
    const confirmed = await confirm({
      title: 'Excluir escala do planejamento',
      message: `Excluir a escala ${row.port}? As datas, o vínculo operacional e o planejamento de exportação serão removidos.`,
      confirmLabel: 'Excluir',
      tone: 'danger',
    })
    if (!confirmed) return
    try {
      await Promise.all([
        row.temImportacao ? deleteVoyagePodSchedule({ voyageId: voyage.id, pod: row.port, changedBy: user.id }) : Promise.resolve(),
        exportSchedule ? deleteVoyageExportSchedule(exportSchedule.id) : Promise.resolve(),
      ])
      await afterEscalaAlterada(queryClient, { voyageId: voyage.id })
      showToast('Escala removida do planejamento.', 'success')
    } catch (error) {
      const classified = classifyDbError(error)
      if (classified.kind === 'permissao') {
        showToast('Sem permissão para excluir a escala. Solicite acesso administrativo.', 'error')
        return
      }
      showToast(`Falha ao excluir a escala. Motivo: ${classified.message}`, 'error')
    }
  }

  const planningContent = (
    <MetricSection
      title="Planejamento por escala"
      compact
      actions={canEditVoyages ? (
        <Button variant="secondary" className="app-btn--sm" onClick={() => onEditEscala(buildEscalaModalData(null))}>
          <Plus size={15} />
          Adicionar escala
        </Button>
      ) : undefined}
    >
      <div className="app-voyage-table-frame">
        <div className="app-table-scroll">
          <table className="app-table app-table--compact app-table--dense app-table--sticky-actions w-full text-left text-sm">
            <colgroup>
              <col className="min-w-[90px]" />
              <col className="min-w-[150px]" />
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
                <th scope="col" className="px-3 py-2">Escala</th>
                <th scope="col" className="px-3 py-2">Opera</th>
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
              {escalaRows.length ? (
                escalaRows.map((row) => {
                  return (
                    <tr key={`${voyage.id}-lineup-${row.port}`}>
                      <td className="px-3 py-2 align-top">
                        <div className="font-semibold text-[var(--app-text-strong)]">{row.port}</div>
                        {row.divergences.length ? <EscalaDivergenceWarning divergences={row.divergences} /> : null}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <EscalaOperationMarkers row={row} />
                      </td>
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
                            aria-label={`Editar planejamento da escala ${row.port}`}
                            onClick={() => onEditEscala(buildEscalaModalData(row))}
                          >
                            <Pencil size={15} />
                          </Button>
                          {canEditVoyages && row.temImportacao && !row.omitted ? (
                            <Button
                              variant="secondary"
                              className="app-voyage-icon-btn"
                              aria-label={`Omitir escala do POD ${row.port}`}
                              title={`Omitir escala do POD ${row.port}`}
                              onClick={() => onOmitPod(row.port)}
                            >
                              <AlertTriangle size={15} />
                            </Button>
                          ) : null}
                          {isAdmin ? (
                            // handleDeleteEscala pode chamar deleteVoyageExportSchedule,
                            // cuja policy de DELETE exige is_admin() (091). Nao trocar
                            // por canEditVoyages sem tambem alinhar a RLS.
                            <Button
                              variant="danger"
                              className="app-voyage-icon-btn"
                              aria-label={`Excluir escala ${row.port}`}
                              onClick={() => handleDeleteEscala(row)}
                            >
                              <Trash2 size={15} />
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={13} className="px-3 py-3 text-[var(--app-muted)]">
                    Nenhuma escala planejada para esta viagem.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MetricSection>
  )

  return (
    <div className="grid gap-4">
      <TransshipmentInfoCard voyageId={voyage.id} />
      {planningContent}
      <VoyageTimeline events={timelineEvents} open={timelineOpen} onToggle={() => setTimelineOpen((value) => !value)} />
    </div>
  )
}

function EscalaOperationMarkers({ row }: { row: VoyageEscalaSchedule }) {
  const markers = [
    row.temImportacao ? <Badge key="importacao" tone="blue">Importação</Badge> : null,
    row.temExportacao ? <Badge key="exportacao" tone="yellow">Exportação</Badge> : null,
    // ponytail: coluna "Opera" mostra só a natureza da operação (imp/exp);
    // granito é modalidade de carga da exportação, não uma operação à parte.
  ].filter(Boolean)

  if (!markers.length) return <span className="text-[var(--app-muted-soft)]">-</span>

  return <div className="flex max-w-[220px] flex-wrap items-center gap-1.5">{markers}</div>
}

function EscalaDivergenceWarning({ divergences }: { divergences: VoyageEscalaDivergence[] }) {
  return (
    <div className="mt-1 grid gap-1 text-[11px] font-medium text-amber-400">
      {divergences.map((divergence, index) => (
        <div key={`${divergence.field}-${divergence.source}-${index}`} className="flex items-start gap-1">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>
            Divergência {formatDivergenceField(divergence.field)}: POD {formatDivergenceValue(divergence.podValue)} / {divergence.source === 'pol' ? 'POL' : 'EXP'} {formatDivergenceValue(divergence.sourceValue)}
          </span>
        </div>
      ))}
    </div>
  )
}

function formatDivergenceField(field: VoyageEscalaDivergence['field']) {
  if (field === 'ceStatus') return 'CEs'
  if (field === 'linked') return 'VINCULADA'
  if (field === 'escalaNumber') return 'Nº Escala'
  return field.toUpperCase()
}

function formatDivergenceValue(value: VoyageEscalaDivergence['podValue'] | VoyageEscalaDivergence['sourceValue']) {
  if (value === null || value === '') return '-'
  if (typeof value === 'boolean') return value ? 'SIM' : 'NÃO'
  return String(value)
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

const TIMELINE_COLLAPSED_COUNT = 3

function VoyageTimeline({
  events,
  open,
  onToggle,
}: {
  events: VoyageTimelineEvent[]
  open: boolean
  onToggle: () => void
}) {
  // Eventos chegam ordenados do mais recente para o mais antigo (buildVoyageTimeline).
  const [expanded, setExpanded] = useState(false)
  const hasMore = events.length > TIMELINE_COLLAPSED_COUNT
  const visibleEvents = expanded ? events : events.slice(0, TIMELINE_COLLAPSED_COUNT)

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
          <>
            <ol className="mt-4 flex flex-col gap-2">
              {visibleEvents.map((event) => (
                <li
                  key={event.id}
                  className="relative flex flex-col gap-0.5 overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-3 pl-4 sm:flex-row sm:items-baseline sm:gap-3"
                >
                  <span
                    className="absolute left-0 top-0 h-full w-1"
                    style={{ backgroundColor: TIMELINE_DOT[event.kind] }}
                  />
                  <div className="shrink-0 text-xs text-[var(--app-muted-soft)] sm:w-36">
                    {formatTimelineMoment(event.at)}
                  </div>
                  <div className="flex flex-1 flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-semibold text-[var(--app-text)]">{event.title}</span>
                    <span className="text-sm leading-snug text-[var(--app-muted)]">{event.detail}</span>
                  </div>
                </li>
              ))}
            </ol>
            {hasMore ? (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="mt-3 text-sm font-medium text-[var(--app-accent,#2563a8)] hover:underline"
              >
                {expanded ? 'Mostrar menos' : `Mostrar todos os ${events.length} eventos`}
              </button>
            ) : null}
          </>
        ) : (
          <div className="mt-3 text-sm text-[var(--app-muted)]">Sem eventos registrados ainda.</div>
        )
      ) : null}
    </section>
  )
}
