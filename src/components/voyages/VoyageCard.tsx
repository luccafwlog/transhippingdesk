import { useMemo, useState } from 'react'
import { ArrowRight, Pencil, Trash2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
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
  getProximaEscala,
  normalizePortName,
  splitVoyageBls,
  voyageCeCoverage,
  voyageHasMissingManifest,
} from '../../pages/viagensHelpers'
import {
  buildVoyagePodEntityId,
  deriveAutomaticVoyagePodCeStatus,
  type VoyagePodSchedule,
  type VoyagePolSchedule,
} from '../../services/voyageRouteSchedules'
import type { VoyageExportSchedule } from '../../services/voyageExportSchedules'
import { ESTADO_CONCILIACAO_META, statusLabel, VOYAGE_STATUS_BADGE_TONE, VOYAGE_STATUS_LABELS } from '../../lib/statusLabels'
import type { VoyageImportBatch } from './voyageCardHelpers'
import { VoyageVisaoTab } from './VoyageVisaoTab'
import { VoyageImportacaoTab } from './VoyageImportacaoTab'
import { VoyageExportacaoTab } from './VoyageExportacaoTab'
import { VoyageManifestosTab } from './VoyageManifestosTab'
import type {
  AddingPodPayload,
  EditingExportPayload,
  EditingPodPayload,
  EditingPolPayload,
  Voyage,
  VoyagePodRow,
} from './voyageCardTypes'

export type {
  Voyage,
  EditingPodPayload,
  EditingPolPayload,
  EditingExportPayload,
  AddingPodPayload,
} from './voyageCardTypes'

type VoyageTabKey = 'visao' | 'importacao' | 'exportacao' | 'manifestos'

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
  const [activeTab, setActiveTab] = useState<VoyageTabKey>('visao')
  const { isAdmin, user } = useAuth()

  const vehicleStats = vehicleStatsProp ?? DEFAULT_VEHICLE_STATS
  const vaziosImpStats = vaziosImpStatsProp ?? DEFAULT_VAZIOS_IMP_STATS
  const voyageLabel = `${voyage.vessel?.name ?? 'Navio'} / ${voyage.voyage_number}`

  const { containerBls } = splitVoyageBls(voyage.bls)
  const importBatches = useMemo<VoyageImportBatch[]>(() => voyage.import_batches ?? [], [voyage.import_batches])
  const containerManifestCount =
    importBatches.filter((batch) => batch.cargo_mode !== 'carga_solta').length || countDistinctBatchIds(containerBls)
  const breakbulkManifestCount =
    importBatches.filter((batch) => batch.cargo_mode === 'carga_solta').length ||
    countDistinctBatchIds(splitVoyageBls(voyage.bls).breakbulkBls)
  const totalImportManifestCount = importBatches.length || containerManifestCount + breakbulkManifestCount
  const totalBls = (voyage.bls ?? []).length
  const billingClosed = totalBls > 0 && voyagesWithUnpaidBls != null && !voyagesWithUnpaidBls.has(voyage.id)
  const flatContainers = containerBls.flatMap((bl) => bl.bl_containers ?? [])
  const totalContainers = countDistinctContainerNumbers(flatContainers)
  const totalImoContainers = countDistinctContainerNumbersBy(flatContainers, (container) => Boolean(container.is_imo))
  const totalOogContainers = countDistinctContainerNumbersBy(flatContainers, (container) => Boolean(container.is_oog))
  const originPorts = collectVoyagePorts(voyage.bls, 'pol', voyage.pol?.name ?? null)
  const destinationPorts = collectVoyagePorts(
    voyage.bls,
    'pod',
    voyage.pod?.name ?? null,
    scheduledPodRows.map((schedule) => schedule.pod),
  )
  const podRows: VoyagePodRow[] = destinationPorts.map((pod) => {
    const schedule = podSchedules?.get(buildVoyagePodEntityId(voyage.id, pod))
    const routeBls = (voyage.bls ?? []).filter((bl) => normalizePortName(bl.pod) === normalizePortName(pod))
    const routeCeFilledCount = routeBls.filter((bl) => String(bl.ce_mercante ?? '').trim()).length
    const autoCeStatus = deriveAutomaticVoyagePodCeStatus(routeCeFilledCount, routeBls.length)
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
  const estadoMeta = ESTADO_CONCILIACAO_META[estado]
  const proximaEscala = getProximaEscala(podRows)

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
                <Badge tone={VOYAGE_STATUS_BADGE_TONE[voyage.status ?? 'active'] ?? 'blue'}>
                  {statusLabel(VOYAGE_STATUS_LABELS, voyage.status ?? 'active')}
                </Badge>
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
            <VoyageVisaoTab
              voyage={voyage}
              voyageLabel={voyageLabel}
              podRows={podRows}
              importBatches={importBatches}
              exportSchedule={exportSchedule}
              isAdmin={isAdmin}
              divergenceCount={divergenceCount}
              ceCoverage={ceCoverage}
              onAddPod={onAddPod}
              onEditPod={onEditPod}
              onEditExport={onEditExport}
            />
          ) : null}
          {activeTab === 'importacao' ? (
            <VoyageImportacaoTab
              voyage={voyage}
              voyageLabel={voyageLabel}
              vehicleStats={vehicleStats}
              vaziosImpStats={vaziosImpStats}
              userId={user?.id}
            />
          ) : null}
          {activeTab === 'exportacao' ? (
            <VoyageExportacaoTab voyage={voyage} voyageLabel={voyageLabel} userId={user?.id} />
          ) : null}
          {activeTab === 'manifestos' ? (
            <VoyageManifestosTab
              voyage={voyage}
              voyageLabel={voyageLabel}
              importBatches={importBatches}
              polSchedules={polSchedules}
              divergenceCount={divergenceCount}
              ceCoverage={ceCoverage}
              missingManifest={missingManifest}
              estadoMeta={estadoMeta}
              onEditPol={onEditPol}
            />
          ) : null}
        </div>
      </section>
    </Card>
  )
}
