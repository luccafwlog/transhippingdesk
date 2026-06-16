import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Boxes, FileText, Gem, Package, Pencil, Plus, Trash2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Info, MetricPanel, MetricSection, NavigationCard } from '../shared/VoyageSectionCards'
import { VoyageImportActions } from '../shared/VoyageImportActions'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import { useVoyageReconciliation } from '../../hooks/useVoyageReconciliation'
import type { VoyageVehicleStat } from '../../hooks/useVehicles'
import type { VoyageVaziosImportacaoStat } from '../../hooks/useVaziosImportacaoStats'
import { countDistinctContainerNumbers, countDistinctContainerNumbersBy } from '../../lib/containerCounts'
import { formatDate } from '../../lib/utils'
import {
  collectVoyagePorts,
  countDistinctBatchIds,
  countPlannedPodRows,
  deriveEstadoConciliacao,
  formatMetric,
  formatPortDisplayName,
  getGraniteModuleStats,
  getProximaEscala,
  getVaziosModuleStats,
  normalizePortName,
  splitVoyageBls,
  stripFileExtension,
  summarizeExportByPol,
  summarizeImportByPod,
  voyageCeCoverage,
  voyageHasMissingManifest,
  type EstadoConciliacao,
  type VoyageBl,
} from '../../pages/viagensHelpers'
import {
  buildVoyagePodEntityId,
  buildVoyagePolEntityId,
  getVoyagePodCeStatusLabel,
  saveVoyagePodSchedule,
  type VoyagePodCeStatus,
  type VoyagePodSchedule,
  type VoyagePolSchedule,
} from '../../services/voyageRouteSchedules'
import { deleteVoyageExportSchedule, type VoyageExportSchedule } from '../../services/voyageExportSchedules'
import { statusLabel, VOYAGE_STATUS_LABELS } from '../../lib/statusLabels'
import type { useVoyages } from '../../hooks/useBls'

export type Voyage = NonNullable<ReturnType<typeof useVoyages>['data']>[number]

type VoyageTabKey = 'visao' | 'importacao' | 'exportacao' | 'manifestos'

const ESTADO_META: Record<EstadoConciliacao, { label: string; color: string; bg: string }> = {
  divergente: { label: 'Divergente', color: '#cf4b3f', bg: 'rgba(207,75,63,0.12)' },
  incompleto: { label: 'Incompleto', color: '#b8860b', bg: 'rgba(224,165,46,0.16)' },
  conciliado: { label: 'Conciliado', color: '#1f7a4d', bg: 'rgba(42,157,99,0.16)' },
}

export type EditingPodPayload = {
  voyageId: number
  voyageLabel: string
  pod: string
  eta: string | null
  etb: string | null
  ata: string | null
  atd: string | null
  rtw: number | null
  ceStatus: VoyagePodCeStatus | null
  linked: boolean | null
}

export type EditingPolPayload = {
  voyageId: number
  voyageLabel: string
  pol: string
  etd: string | null
}

export type EditingExportPayload = {
  voyageId: number
  voyageLabel: string
  existing: VoyageExportSchedule | null
}

export type AddingPodPayload = { voyageId: number; voyageLabel: string }

const DEFAULT_VEHICLE_STATS: VoyageVehicleStat = {
  totalVehicles: 0,
  distinctContainerCount: 0,
  containerNumbers: [],
  brandSummary: '-',
  vehicleByContainerTypeSummary: '-',
}

const DEFAULT_VAZIOS_IMP_STATS: VoyageVaziosImportacaoStat = {
  totalManifests: 0,
  distinctContainers: 0,
  containerTypes: '',
  destinations: '',
}

type VoyageCardProps = {
  voyage: Voyage
  vehicleStats: VoyageVehicleStat | undefined
  vaziosImpStats: VoyageVaziosImportacaoStat | undefined
  voyagesWithUnpaidBls: Set<number> | null | undefined
  podSchedules: Map<string, VoyagePodSchedule> | undefined
  polSchedules: Map<string, VoyagePolSchedule> | undefined
  scheduledPodRows: VoyagePodSchedule[]
  exportSchedule: VoyageExportSchedule | null
  onEditVoyage: (voyageId: number) => void
  onDeleteVoyage: (voyageId: number) => void
  onEditPod: (payload: EditingPodPayload) => void
  onEditPol: (payload: EditingPolPayload) => void
  onAddPod: (payload: AddingPodPayload) => void
  onEditExport: (payload: EditingExportPayload) => void
}

export function VoyageCard({
  voyage,
  vehicleStats: vehicleStatsProp,
  vaziosImpStats: vaziosImpStatsProp,
  voyagesWithUnpaidBls,
  podSchedules,
  polSchedules,
  scheduledPodRows,
  exportSchedule,
  onEditVoyage,
  onDeleteVoyage,
  onEditPod,
  onEditPol,
  onAddPod,
  onEditExport,
}: VoyageCardProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<VoyageTabKey>('visao')
  const { showToast } = useToast()
  const { isAdmin, user } = useAuth()

  const vehicleStats = vehicleStatsProp ?? DEFAULT_VEHICLE_STATS
  const vaziosImpStats = vaziosImpStatsProp ?? DEFAULT_VAZIOS_IMP_STATS
  const voyageLabel = `${voyage.vessel?.name ?? 'Navio'} / ${voyage.voyage_number}`

  const { containerBls, breakbulkBls } = splitVoyageBls(voyage.bls)
  const importBatches = voyage.import_batches ?? []
  const distinctContainerBatchCount = countDistinctBatchIds(containerBls)
  const distinctBreakbulkBatchCount = countDistinctBatchIds(breakbulkBls)
  const containerManifestCount =
    importBatches.filter((batch) => batch.cargo_mode !== 'carga_solta').length || distinctContainerBatchCount
  const breakbulkManifestCount =
    importBatches.filter((batch) => batch.cargo_mode === 'carga_solta').length || distinctBreakbulkBatchCount
  const totalImportManifestCount =
    importBatches.length || containerManifestCount + breakbulkManifestCount
  const totalBls = (voyage.bls ?? []).length
  const billingClosed = totalBls > 0 && voyagesWithUnpaidBls != null && !voyagesWithUnpaidBls.has(voyage.id)
  const flatContainers = containerBls.flatMap((bl) => bl.bl_containers ?? [])
  const totalContainers = countDistinctContainerNumbers(flatContainers)
  const totalImoContainers = countDistinctContainerNumbersBy(flatContainers, (container) => Boolean(container.is_imo))
  const totalOogContainers = countDistinctContainerNumbersBy(flatContainers, (container) => Boolean(container.is_oog))
  const totalBreakbulkWeightTon = breakbulkBls.reduce(
    (sum, bl) => sum + Number(bl.bb_weight_ton ?? (bl.total_weight_kg ? Number(bl.total_weight_kg) / 1000 : 0)),
    0,
  )
  const graniteStats = getGraniteModuleStats(voyage.granite_manifests)
  const vaziosStats = getVaziosModuleStats(voyage.vazios_manifests)
  const originPorts = collectVoyagePorts(voyage.bls, 'pol', voyage.pol?.name ?? null)
  const destinationPorts = collectVoyagePorts(
    voyage.bls,
    'pod',
    voyage.pod?.name ?? null,
    scheduledPodRows.map((schedule) => schedule.pod),
  )
  const importByPod = summarizeImportByPod(voyage.bls, vehicleStats.containerNumbers)
  const exportByPol = summarizeExportByPol(voyage.granite_manifests, voyage.vazios_manifests)
  const podRows = destinationPorts.map((pod) => {
    const schedule = podSchedules?.get(buildVoyagePodEntityId(voyage.id, pod))
    const routeBls = (voyage.bls ?? []).filter((bl) => normalizePortName(bl.pod) === normalizePortName(pod))
    const routeCeFilledCount = routeBls.filter((bl) => String(bl.ce_mercante ?? '').trim()).length
    const autoCeStatus =
      routeBls.length === 0
        ? null
        : routeCeFilledCount === routeBls.length
          ? 'approved'
          : routeCeFilledCount > 0
            ? 'partial'
            : 'missing'
    return {
      pod,
      eta: schedule?.eta ?? null,
      etb: schedule?.etb ?? null,
      ata: schedule?.ata ?? null,
      atd: schedule?.atd ?? null,
      rtw: schedule?.rtw ?? null,
      ceStatus: schedule?.ceStatus ?? autoCeStatus,
      linked: schedule?.linked ?? false,
      escalaNumber: schedule?.escalaNumber ?? null,
    }
  })
  const plannedPodCount = countPlannedPodRows(podRows)
  const manifestRows = collectVoyageManifestRowsGroupedByRoute({
    voyageId: voyage.id,
    batches: importBatches,
    bls: voyage.bls,
    polSchedules,
  })

  // Estado de Conciliação: divergências da viagem aberta (uma consulta) +
  // sinais baratos do payload.
  const { data: reconciliation } = useVoyageReconciliation(voyage.id)
  const divergenceCount = reconciliation?.items.length ?? 0
  const ceCoverage = voyageCeCoverage(voyage.bls)
  const missingManifest = voyageHasMissingManifest({ bls: voyage.bls, batches: importBatches })
  const estado = deriveEstadoConciliacao({
    hasOpenDivergences: divergenceCount > 0,
    ceFilled: ceCoverage.filled,
    ceTotal: ceCoverage.total,
    hasMissingManifest: missingManifest,
  })
  const estadoMeta = ESTADO_META[estado]
  const proximaEscala = getProximaEscala(podRows)

  const planningContent = (
    <MetricSection
      title="Planejamento por POD/POL"
      description="Datas ETA, ETB, ATA e ATD, RESTOW, BLs e CEs, ESCALA e Nº de Escala por porto de descarga ou embarque."
      actions={isAdmin ? (
        <>
          <Button variant="secondary" onClick={() => onAddPod({ voyageId: voyage.id, voyageLabel })}>
            <Plus size={15} />
            Adicionar POD
          </Button>
          <Button
            variant="secondary"
            onClick={() => onEditExport({ voyageId: voyage.id, voyageLabel, existing: exportSchedule })}
          >
            <Plus size={15} />
            Adicionar POL
          </Button>
        </>
      ) : undefined}
    >
      <div className="app-voyage-table-frame">
        <table className="app-table app-table--compact app-table--dense w-full table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[9%]" />
            <col className="w-[13%]" />
            <col className="w-[8%]" />
            <col className="w-[12%]" />
            <col className="w-[8%]" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2">POD/POL</th>
              <th scope="col" className="px-3 py-2">ETA</th>
              <th scope="col" className="px-3 py-2">ETB</th>
              <th scope="col" className="px-3 py-2">ATA</th>
              <th scope="col" className="px-3 py-2">ATD</th>
              <th scope="col" className="px-3 py-2">RESTOW</th>
              <th scope="col" className="px-3 py-2">BLs e CEs</th>
              <th scope="col" className="px-3 py-2">ESCALA</th>
              <th scope="col" className="px-3 py-2">Nº Escala</th>
              <th scope="col" className="px-3 py-2">Acoes</th>
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
                  <td className="px-3 py-2">{formatDate(row.atd)}</td>
                  <td className="px-3 py-2">{row.rtw === null ? '-' : formatMetric(row.rtw)}</td>
                  <td className="px-3 py-2">{renderCeStatusLabel(row.ceStatus)}</td>
                  <td className="px-3 py-2">{renderLinkedLabel(row.linked)}</td>
                  <td className="px-3 py-2">{renderEscalaNumber(row.escalaNumber)}</td>
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
                            atd: row.atd,
                            rtw: row.rtw,
                            ceStatus: row.ceStatus,
                            linked: row.linked,
                          })
                        }
                      >
                        <Pencil size={15} />
                      </Button>
                      {isAdmin ? (
                        <Button
                          variant="danger"
                          className="app-voyage-icon-btn"
                          aria-label={`Excluir planejamento do POD ${row.pod}`}
                          onClick={async () => {
                            const routeBls = (voyage.bls ?? []).filter(
                              (bl) => normalizePortName(bl.pod) === normalizePortName(row.pod),
                            )
                            const hasScheduleData = Boolean(
                              row.eta || row.etb || row.ata || row.atd || row.rtw !== null,
                            )
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
                            try {
                              await saveVoyagePodSchedule({
                                voyageId: voyage.id,
                                pod: row.pod,
                                eta: null,
                                etb: null,
                                ata: null,
                                atd: null,
                                rtw: null,
                                ceStatus: 'waiting',
                                linked: false,
                                changedBy: user.id,
                              })
                              await Promise.all([
                                queryClient.invalidateQueries({ queryKey: ['voyage-pod-schedules'] }),
                                queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] }),
                                queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] }),
                              ])
                              showToast('Dados do planejamento do POD limpos com sucesso.', 'success')
                            } catch (error) {
                              const errorText = extractErrorText(error)
                              if (errorText.includes('42501') || errorText.includes('permission denied')) {
                                showToast('Sem permissão para excluir planejamento do POD. Solicite acesso administrativo.', 'error')
                                return
                              }
                              showToast(
                                `Falha ao excluir planejamento do POD.${errorText ? ` Motivo: ${errorText}` : ''}`,
                                'error',
                              )
                            }
                          }}
                        >
                          <Trash2 size={15} />
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={10} className="px-3 py-3 text-[var(--app-muted)]">
                  Nenhum POD planejado para esta viagem.
                </td>
              </tr>
            )}
            {exportSchedule ? (
              <tr className="border-t border-amber-900/40 bg-amber-950/20">
                <td className="px-3 py-2 font-semibold text-amber-400">
                  {exportSchedule.pol ?? 'POL'}
                  <span className="ml-1 text-xs text-amber-600">EXP</span>
                </td>
                <td className="px-3 py-2">{formatDate(exportSchedule.eta)}</td>
                <td className="px-3 py-2">{formatDate(exportSchedule.etb)}</td>
                <td colSpan={3} className="px-3 py-2 text-amber-500/80 text-xs">
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
                        onClick={() =>
                          onEditExport({ voyageId: voyage.id, voyageLabel, existing: exportSchedule })
                        }
                      >
                        <Pencil size={15} />
                      </Button>
                      <Button
                        variant="danger"
                        className="app-voyage-icon-btn"
                        aria-label="Excluir POL de exportação"
                        onClick={async () => {
                          try {
                            await deleteVoyageExportSchedule(exportSchedule.id)
                            await Promise.all([
                              queryClient.invalidateQueries({ queryKey: ['voyage-export-schedules'] }),
                              queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] }),
                              queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] }),
                            ])
                            showToast('Planejamento de exportação removido.', 'success')
                          } catch {
                            showToast('Falha ao remover planejamento de exportação.', 'error')
                          }
                        }}
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

  const importacaoContent = (
    <>
      {importByPod.length ? (
        <div className="grid gap-4">
          {importByPod.map((pod) => (
            <div key={`${voyage.id}-imp-${pod.pod}`} className="app-panel app-panel--padded grid gap-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="app-panel__title text-base">{formatPortDisplayName(pod.pod)}</div>
                <div className="text-xs text-[var(--app-muted)]">
                  {pod.containers.distinct} CNTRs · {pod.breakbulk.bls} B/Ls carga solta
                  {pod.vehicles.distinctContainers ? ` · ${pod.vehicles.distinctContainers} CNTRs c/ veículos` : ''}
                </div>
              </div>
              <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
                <MetricPanel title="Containers">
                  <Info label="CNTRS distintos" value={String(pod.containers.distinct)} />
                  <Info label="Containers IMO" value={String(pod.containers.imo)} />
                  <Info label="Containers OOG" value={String(pod.containers.oog)} />
                  <Info label="Tipos de container" value={pod.containers.types || '-'} />
                </MetricPanel>
                {pod.vehicles.distinctContainers ? (
                  <MetricPanel title="Veiculos">
                    <Info label="Containers com veiculos" value={String(pod.vehicles.distinctContainers)} />
                    <Info label="Carga geral (CNTRs)" value={String(pod.generalCargo.distinct)} />
                  </MetricPanel>
                ) : null}
                {pod.breakbulk.bls ? (
                  <MetricPanel title="Carga solta">
                    <Info label="B/Ls carga solta" value={String(pod.breakbulk.bls)} />
                    <Info label="Maquinas" value={formatMetric(pod.breakbulk.machines)} />
                    <Info label="Packages" value={formatMetric(pod.breakbulk.packages)} />
                    <Info label="Weight total" value={`${formatMetric(pod.breakbulk.weightTon)} ton`} />
                    <Info label="CBM total" value={formatMetric(pod.breakbulk.cbm)} />
                  </MetricPanel>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="app-panel app-panel--padded text-sm text-[var(--app-muted)]">
          Nenhuma carga de importação vinculada a esta viagem.
        </div>
      )}

      {vaziosImpStats.totalManifests ? (
        <MetricPanel title="Vazios Importacao">
          <Info label="Manifestos" value={String(vaziosImpStats.totalManifests)} />
          <Info label="Containers distintos" value={String(vaziosImpStats.distinctContainers)} />
          <Info label="Tipos" value={vaziosImpStats.containerTypes || '-'} />
          <Info label="Destinos" value={vaziosImpStats.destinations || '-'} />
        </MetricPanel>
      ) : null}

      {user?.id ? (
        <MetricSection
          title="Importação rápida"
          description="Importe manifestos e planilhas diretamente nesta viagem sem sair da tela."
        >
          <VoyageImportActions
            voyageId={voyage.id}
            voyageLabel={voyageLabel}
            userId={user.id}
            types={['cntr', 'bb', 'vaziosImp', 'vehicles', 'baplie']}
          />
        </MetricSection>
      ) : null}
    </>
  )

  const exportacaoContent = (
    <>
      {exportByPol.length ? (
        <div className="grid gap-4">
          {exportByPol.map((pol) => (
            <div key={`${voyage.id}-exp-${pol.pol}`} className="app-panel app-panel--padded grid gap-4">
              <div className="app-panel__title text-base">{formatPortDisplayName(pol.pol)}</div>
              <div className="grid gap-4 xl:grid-cols-2">
                <MetricPanel title="Granito">
                  <Info label="Manifestos" value={String(pol.granite.manifests)} />
                  <Info label="B/Ls" value={String(pol.granite.bls)} />
                  <Info label="Peso total" value={`${formatMetric(pol.granite.weightTon)} ton`} />
                  <Info label="Prontos faturamento" value={String(pol.granite.readyForBilling)} />
                  <Info label="Faturados" value={String(pol.granite.invoiced)} />
                </MetricPanel>
                <MetricPanel title="Vazios">
                  <Info label="Bookings" value={String(pol.vazios.bookings)} />
                  <Info label="Containers distintos" value={String(pol.vazios.distinctContainers)} />
                  <Info label="Tipos" value={pol.vazios.types || '-'} />
                  <Info label="Destinos" value={pol.vazios.destinations || '-'} />
                </MetricPanel>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="app-panel app-panel--padded text-sm text-[var(--app-muted)]">
          Nenhuma carga de exportação vinculada a esta viagem.
        </div>
      )}

      {user?.id ? (
        <MetricSection
          title="Exportação rápida"
          description="Importe manifestos e planilhas de exportação diretamente nesta viagem."
        >
          <VoyageImportActions
            voyageId={voyage.id}
            voyageLabel={voyageLabel}
            userId={user.id}
            types={['granite', 'vaziosExp']}
          />
        </MetricSection>
      ) : null}
    </>
  )

  const manifestosContent = (
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
              {missingManifest ? ' · manifesto faltando' : ''}
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
            Um manifesto por linha, com ETD editavel e quantidade de B/Ls vinculados.
          </div>
        </div>

        <div className="app-voyage-table-frame">
          <div className="app-table-scroll">
            <table className="app-table app-table--compact app-table--dense w-full table-fixed text-left text-sm">
              <colgroup>
                <col className="w-[52%]" />
                <col className="w-[18%]" />
                <col className="w-[14%]" />
                <col className="w-[16%]" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className="px-3 py-2">Manifesto</th>
                  <th scope="col" className="px-3 py-2">ETD</th>
                  <th scope="col" className="px-3 py-2">B/Ls</th>
                  <th scope="col" className="px-3 py-2">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {manifestRows.length ? (
                  manifestRows.map((row) => (
                    <tr key={`${voyage.id}-manifest-${row.batchId}`}>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-[var(--app-text-strong)]">{row.routeLabel}</div>
                        <div className="text-xs text-[var(--app-muted)]">{row.filenameLabel}</div>
                      </td>
                      <td className="px-3 py-2">{formatDate(row.etd)}</td>
                      <td className="px-3 py-2">{row.blCount}</td>
                      <td className="px-3 py-2">
                        <Button
                          variant="secondary"
                          className="app-voyage-icon-btn"
                          aria-label={`Editar ETD do manifesto ${row.filenameLabel}`}
                          onClick={() =>
                            onEditPol({
                              voyageId: voyage.id,
                              voyageLabel,
                              pol: row.pol,
                              etd: row.etd,
                            })
                          }
                          disabled={!row.pol || row.pol === '-'}
                        >
                          <Pencil size={15} />
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-3 py-3 text-[var(--app-muted)]">
                      Nenhum manifesto identificado nesta viagem.
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

  const tabs: Array<{ key: VoyageTabKey; label: string }> = [
    { key: 'visao', label: 'Visão geral' },
    { key: 'importacao', label: 'Importação' },
    { key: 'exportacao', label: 'Exportação' },
    { key: 'manifestos', label: 'Escalas & Manifestos' },
  ]

  return (
    <Card className="grid gap-5">
      <section className="app-voyage-hero">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="grid gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-[var(--app-muted-soft)]">
                {voyage.vessel?.carrier?.name ?? 'Armador nao informado'}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-bold text-[var(--app-text-strong)]">
                  {voyage.vessel?.name ?? 'Navio'} / {voyage.voyage_number}
                </h2>
                <span className="rounded-full border border-[#1f6feb]/30 bg-[#1f6feb]/10 px-3 py-1 text-xs font-semibold text-[#8cc8ff]">
                  {statusLabel(VOYAGE_STATUS_LABELS, voyage.status ?? 'active')}
                </span>
                {billingClosed ? (
                  <span
                    className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300"
                    title="Todos os B/Ls desta viagem estao quitados ou isentos."
                  >
                    Faturamento Encerrado
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--app-muted)]">
              <div className="flex flex-wrap items-center gap-2">
                {originPorts.length ? (
                  originPorts.map((port) => (
                    <span key={`${voyage.id}-origin-${port}`} className="app-voyage-token">
                      {port}
                    </span>
                  ))
                ) : (
                  <span className="app-voyage-token">Origem a definir</span>
                )}
              </div>
              <ArrowRight size={16} className="text-[var(--app-muted)]" />
              <div className="flex flex-wrap items-center gap-2">
                {destinationPorts.length ? (
                  destinationPorts.map((port) => (
                    <span key={`${voyage.id}-destination-${port}`} className="app-voyage-token">
                      {port}
                    </span>
                  ))
                ) : (
                  <span className="app-voyage-token">Destino a definir</span>
                )}
              </div>
            </div>
          </div>

          {isAdmin ? (
            <div className="flex items-center gap-2 self-start">
              <Button variant="ghost" className="app-voyage-action-icon" onClick={() => onEditVoyage(voyage.id)}>
                <Pencil size={15} />
                Editar
              </Button>
              <Button
                variant="ghost"
                className="app-voyage-action-icon app-voyage-action-icon--danger"
                onClick={() => onDeleteVoyage(voyage.id)}
                aria-label="Excluir viagem"
                title="Excluir viagem"
              >
                <Trash2 size={15} />
              </Button>
            </div>
          ) : null}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label="B/Ls" value={String(totalBls)} sub={`${totalImportManifestCount} manifesto${totalImportManifestCount === 1 ? '' : 's'}`} />
        <KpiTile label="CNTRs distintos" value={String(totalContainers)} sub={`${totalImoContainers} IMO · ${totalOogContainers} OOG`} />
        <KpiTile
          label="Próxima escala"
          value={proximaEscala ? proximaEscala.pod : '—'}
          sub={proximaEscala ? formatDate(proximaEscala.eta) : `${plannedPodCount} escala${plannedPodCount === 1 ? '' : 's'} planejada${plannedPodCount === 1 ? '' : 's'}`}
        />
        <KpiTile
          label="Conciliação"
          value={estadoMeta.label}
          valueColor={estadoMeta.color}
          sub={`CE ${ceCoverage.filled}/${ceCoverage.total}${divergenceCount ? ` · ${divergenceCount} diverg.` : missingManifest ? ' · manifesto faltando' : ''}`}
        />
      </section>

      <section className="grid gap-4">
        <div className="flex flex-wrap gap-1 border-b border-[var(--app-border)]">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              aria-current={activeTab === tab.key}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
                activeTab === tab.key
                  ? 'border-[var(--app-blue-btn)] text-[var(--app-blue-btn)]'
                  : 'border-transparent text-[var(--app-muted)] hover:text-[var(--app-text)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="grid gap-4">
          {activeTab === 'visao' ? (
            <>
              {planningContent}
              {navCardsContent}
            </>
          ) : null}
          {activeTab === 'importacao' ? importacaoContent : null}
          {activeTab === 'exportacao' ? exportacaoContent : null}
          {activeTab === 'manifestos' ? manifestosContent : null}
        </div>
      </section>
    </Card>
  )
}

function KpiTile({ label, value, sub, valueColor }: { label: string; value: string; sub?: string; valueColor?: string }) {
  return (
    <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-4 py-3">
      <div className="text-lg font-bold text-[var(--app-text-strong)]" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--app-muted)]">{label}</div>
      {sub ? <div className="text-[11px] text-[var(--app-muted-soft)]">{sub}</div> : null}
    </div>
  )
}

function renderEscalaNumber(value: string | null) {
  if (!value) return <span className="text-[var(--app-muted-soft)]">-</span>
  return <span className="font-mono text-xs text-[var(--app-text-strong)]">{value}</span>
}

function renderCeStatusLabel(status: VoyagePodCeStatus | null) {
  return getVoyagePodCeStatusLabel(status)
}

function renderLinkedLabel(linked: boolean | null) {
  return linked ? 'SIM' : 'NÃO'
}

type VoyageImportBatch = {
  id: number
  voyage_id: number | null
  cargo_mode: 'container' | 'carga_solta' | null
  filename: string
  uploaded_at: string | null
  status: 'processing' | 'completed' | 'partial' | 'failed' | null
  total_bls: number | null
}

function collectVoyageManifestRowsGroupedByRoute({
  voyageId,
  batches,
  bls,
  polSchedules,
}: {
  voyageId: number
  batches: VoyageImportBatch[] | null | undefined
  bls: VoyageBl[] | null | undefined
  polSchedules?: Map<string, { etd: string | null }> | undefined
}) {
  const blsByBatch = new Map<number, VoyageBl[]>()
  const routeGroups = new Map<
    string,
    {
      pol: string
      pod: string
      blCount: number
      filenames: string[]
      modeLabels: string[]
      batchIds: number[]
      sortDate: number
    }
  >()

  for (const bl of bls ?? []) {
    if (!bl.batch_id) continue
    const current = blsByBatch.get(bl.batch_id) ?? []
    current.push(bl)
    blsByBatch.set(bl.batch_id, current)
  }

  for (const batch of batches ?? []) {
    const batchBls = blsByBatch.get(batch.id) ?? []
    const pol = batchBls[0]?.pol?.trim() || '-'
    const pod = batchBls[0]?.pod?.trim() || '-'
    const routeKey = `${normalizePortName(pol)}::${normalizePortName(pod)}`
    const filename = stripFileExtension(batch.filename || `manifesto-${batch.id}`)
    const modeLabel = batch.cargo_mode === 'carga_solta' ? 'BB' : 'CNTR'
    const batchSortDate = Date.parse(batch.uploaded_at ?? '')
    const current = routeGroups.get(routeKey)

    if (current) {
      current.blCount += Number(batch.total_bls ?? batchBls.length)
      current.batchIds.push(batch.id)
      if (!current.filenames.includes(filename)) current.filenames.push(filename)
      if (!current.modeLabels.includes(modeLabel)) current.modeLabels.push(modeLabel)
      if (Number.isFinite(batchSortDate) && (!Number.isFinite(current.sortDate) || batchSortDate < current.sortDate)) {
        current.sortDate = batchSortDate
      }
      continue
    }

    routeGroups.set(routeKey, {
      pol,
      pod,
      blCount: Number(batch.total_bls ?? batchBls.length),
      filenames: [filename],
      modeLabels: [modeLabel],
      batchIds: [batch.id],
      sortDate: batchSortDate,
    })
  }

  return Array.from(routeGroups.values())
    .sort((left, right) => {
      if (Number.isFinite(left.sortDate) && Number.isFinite(right.sortDate) && left.sortDate !== right.sortDate) {
        return left.sortDate - right.sortDate
      }
      return left.pol.localeCompare(right.pol, 'pt-BR') || left.pod.localeCompare(right.pod, 'pt-BR')
    })
    .map((group) => ({
      batchId: group.batchIds.join('-'),
      pol: group.pol,
      etd: polSchedules?.get(buildVoyagePolEntityId(voyageId, group.pol))?.etd ?? null,
      blCount: group.blCount,
      routeLabel: `${formatPortDisplayName(group.pol)} -> ${formatPortDisplayName(group.pod)}`,
      filenameLabel: `${group.modeLabels.join('/')} | ${group.filenames.join(', ')}`,
    }))
}

function extractErrorText(error: unknown) {
  if (!error) return ''
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (typeof error === 'object') {
    const candidate = error as { code?: string | null; message?: string | null; details?: string | null; hint?: string | null }
    return [candidate.code, candidate.message, candidate.details, candidate.hint].filter(Boolean).join(' ').trim()
  }
  return ''
}
