import { useMemo, useState } from 'react'
import { ArrowRight, Ban, Pencil, Trash2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { useAuth } from '../../hooks/useAuth'
import { useVoyageReconciliation } from '../../hooks/useVoyageReconciliation'
import { useClosedAgencyReportPorts } from '../../hooks/useAgencyReport'
import type { VoyageVehicleStat } from '../../hooks/useVehicles'
import type { VoyageVaziosImportacaoStat } from '../../hooks/useVaziosImportacaoStats'
import { countDistinctContainerNumbers, countDistinctContainerNumbersBy } from '../../lib/containerCounts'
import { formatDate } from '../../lib/utils'
import {
  collectVoyagePorts,
  computeAdrEscalaPods,
  countDistinctRoutes,
  countPlannedPodRows,
  deriveEstadoConciliacao,
  getProximaEscala,
  isEtaOverdue,
  splitVoyageBls,
  voyageCeCoverage,
} from '../../services/voyageSummaries'
import { normalizePortName } from '../../lib/voyageFormat'
import { normalizePortCode } from '../../services/portCode'
import {
  deriveAutomaticVoyagePodCeStatus,
  type VoyageEscalaSchedule,
  type VoyagePolSchedule,
} from '../../services/voyageRouteSchedules'
import type { VoyageExportSchedule } from '../../services/voyageExportSchedules'
import { ESTADO_CONCILIACAO_META, statusLabel, VOYAGE_STATUS_BADGE_TONE, VOYAGE_STATUS_LABELS } from '../../lib/statusLabels'
import type { VoyageImportBatch } from './voyageCardHelpers'
import { VoyageVisaoTab } from './VoyageVisaoTab'
import { VoyageImportacaoTab } from './VoyageImportacaoTab'
import { VoyageExportacaoTab } from './VoyageExportacaoTab'
import { VoyageManifestosTab } from './VoyageManifestosTab'
import { VoyageAgencyReportTab } from './VoyageAgencyReportTab'
import { OmitEscalaModal } from './OmitEscalaModal'
import { TransshipmentPanel } from './TransshipmentPanel'
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

export type VoyageTabKey = 'visao' | 'importacao' | 'exportacao' | 'manifestos' | 'adr'

function KpiTile({
  label,
  value,
  sub,
  alert,
  valueColor,
}: {
  label: string
  value: string
  sub?: string
  alert?: string
  valueColor?: string
}) {
  return (
    <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-4 py-3">
      <div className="text-lg font-bold text-[var(--app-text-strong)]" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--app-muted)]">{label}</div>
      {sub ? <div className="text-[11px] text-[var(--app-muted-soft)]">{sub}</div> : null}
      {alert ? <Badge tone="yellow" className="mt-1 normal-case">{alert}</Badge> : null}
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
  polSchedules: Map<string, VoyagePolSchedule> | undefined
  routeCeMasters: Map<string, string> | undefined
  scheduledEscalaRows: VoyageEscalaSchedule[]
  exportSchedules: VoyageExportSchedule[]
  onEditVoyage: (voyageId: number) => void
  onDeleteVoyage: (voyageId: number) => void
  onCancelVoyage: (voyageId: number) => void
  onEditPod: (payload: EditingPodPayload) => void
  onEditPol: (payload: EditingPolPayload) => void
  onAddPod: (payload: AddingPodPayload) => void
  onEditExport: (payload: EditingExportPayload) => void
  initialTab?: VoyageTabKey
  initialEscala?: string
}

export function VoyageCard({
  voyage,
  vehicleStats: vehicleStatsProp,
  vaziosImpStats: vaziosImpStatsProp,
  voyagesWithUnpaidBls,
  polSchedules,
  routeCeMasters,
  scheduledEscalaRows,
  exportSchedules,
  onEditVoyage,
  onDeleteVoyage,
  onCancelVoyage,
  onEditPod,
  onEditPol,
  onAddPod,
  onEditExport,
  initialTab = 'visao',
  initialEscala,
}: VoyageCardProps) {
  const [activeTab, setActiveTab] = useState<VoyageTabKey>(initialTab)
  const [omitTarget, setOmitTarget] = useState<string | null>(null)
  const { isAdmin, user } = useAuth()

  const vehicleStats = vehicleStatsProp ?? DEFAULT_VEHICLE_STATS
  const vaziosImpStats = vaziosImpStatsProp ?? DEFAULT_VAZIOS_IMP_STATS
  const voyageLabel = `${voyage.vessel?.name ?? 'Navio'} / ${voyage.voyage_number}`

  const { containerBls } = splitVoyageBls(voyage.bls)
  const importBatches = useMemo<VoyageImportBatch[]>(() => voyage.import_batches ?? [], [voyage.import_batches])
  // Contagem por rota (par POL/POD), não por arquivo de manifesto (#315): viagens
  // só-B/L não têm batch, e dois arquivos da mesma rota são uma rota só.
  const totalImportManifestCount = countDistinctRoutes(voyage.bls)
  const totalBls = (voyage.bls ?? []).length
  const billingClosed = totalBls > 0 && voyagesWithUnpaidBls != null && !voyagesWithUnpaidBls.has(voyage.id)
  const flatContainers = containerBls.flatMap((bl) => bl.bl_containers ?? [])
  const totalContainers = countDistinctContainerNumbers(flatContainers)
  const totalImoContainers = countDistinctContainerNumbersBy(flatContainers, (container) => Boolean(container.is_imo))
  const totalOogContainers = countDistinctContainerNumbersBy(flatContainers, (container) => Boolean(container.is_oog))
  const exportEscalas = scheduledEscalaRows.filter((schedule) => schedule.temExportacao)
  const originPorts = collectVoyagePorts(voyage.bls, 'pol', voyage.pol?.name ?? null, exportEscalas)
  const destinationPorts = collectVoyagePorts(
    voyage.bls,
    'pod',
    null,
    scheduledEscalaRows,
  )
  const escalasByPort = new Map(scheduledEscalaRows.map((schedule) => [normalizePortCode(schedule.port) ?? normalizePortName(schedule.port), schedule]))
  const podRows: VoyagePodRow[] = destinationPorts.map((pod) => {
    const schedule = escalasByPort.get(normalizePortCode(pod) ?? normalizePortName(pod))
    const routeBls = (voyage.bls ?? []).filter((bl) => (normalizePortCode(bl.pod) ?? normalizePortName(bl.pod)) === (normalizePortCode(pod) ?? normalizePortName(pod)))
    const routeCeFilledCount = routeBls.filter((bl) => String(bl.ce_mercante ?? '').trim()).length
    const autoCeStatus = deriveAutomaticVoyagePodCeStatus(routeCeFilledCount, routeBls.length)
    return {
      pod: schedule?.port ?? pod,
      eta: schedule?.eta ?? null,
      etb: schedule?.etb ?? null,
      ata: schedule?.ata ?? null,
      atb: schedule?.atb ?? null,
      etd: schedule?.etd ?? null,
      atd: schedule?.atd ?? null,
      rtw: schedule?.rtw ?? null,
      ceStatus: schedule?.ceStatus ?? autoCeStatus,
      linked: schedule?.linked ?? false,
      escalaNumber: schedule?.escalaNumber ?? null,
      omitted: schedule?.omitted ?? false,
    }
  })
  const activePods = podRows.filter((row) => !row.omitted).map((row) => row.pod)
  const planningEscalaRows = (() => {
    const knownPorts = new Set(scheduledEscalaRows.map((row) => normalizePortCode(row.port) ?? normalizePortName(row.port)))
    const blOnlyRows: VoyageEscalaSchedule[] = destinationPorts
      .filter((port) => !knownPorts.has(normalizePortCode(port) ?? normalizePortName(port)))
      .map((port) => ({
        entityId: `${voyage.id}::${port}`,
        voyageId: voyage.id,
        port,
        eta: null,
        etb: null,
        ata: null,
        atb: null,
        etd: null,
        atd: null,
        rtw: null,
        ceStatus: null,
        podCeStatus: null,
        exportCeStatus: null,
        linked: null,
        escalaNumber: null,
        omitted: false,
        deleted: false,
        temImportacao: true,
        temExportacao: false,
        temGranito: false,
        containersQty: null,
        movementsQty: null,
        divergences: [],
      }))
    return [...scheduledEscalaRows, ...blOnlyRows]
  })()
  const plannedPodCount = countPlannedPodRows(podRows)

  // Escalas do ADR (Task 2 do ADR 2026-07-31): não omitidas + omitidas que já
  // têm ADR fechado (registro imutável, não pode ficar inalcançável). podRows
  // já é recalculado a cada render, então nenhuma memoização adicional é
  // necessária aqui.
  const { data: closedAdrPorts } = useClosedAgencyReportPorts(voyage.id)
  const adrPods = computeAdrEscalaPods(podRows, closedAdrPorts ?? [])

  // Estado de Conciliação: divergências da viagem aberta (uma consulta) +
  // sinais baratos do payload.
  const { data: reconciliation } = useVoyageReconciliation(voyage.id)
  const divergenceCount = reconciliation?.items.length ?? 0
  const ceCoverage = voyageCeCoverage(voyage.bls)
  const estado = deriveEstadoConciliacao({
    hasOpenDivergences: divergenceCount > 0,
    ceFilled: ceCoverage.filled,
    ceTotal: ceCoverage.total,
  })
  const estadoMeta = ESTADO_CONCILIACAO_META[estado]
  const proximaEscala = getProximaEscala(podRows)

  const tabs: Array<{ key: VoyageTabKey; label: string }> = [
    { key: 'visao', label: 'Visão geral' },
    { key: 'importacao', label: 'Importação' },
    { key: 'exportacao', label: 'Exportação' },
    { key: 'manifestos', label: 'Escalas & Manifestos' },
    { key: 'adr', label: 'ADR' },
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
                onClick={() => onCancelVoyage(voyage.id)}
                disabled={voyage.status === 'cancelled'}
              >
                <Ban size={15} />
                Cancelar viagem
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
          alert={proximaEscala && isEtaOverdue(proximaEscala.eta) ? 'ETA vencido — ATA pendente' : undefined}
        />
        <KpiTile
          label="Conciliação"
          value={estadoMeta.label}
          valueColor={estadoMeta.color}
          sub={`CE ${ceCoverage.filled}/${ceCoverage.total}${divergenceCount ? ` · ${divergenceCount} diverg.` : ''}`}
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
              escalaRows={planningEscalaRows}
              importBatches={importBatches}
              exportSchedules={exportSchedules}
              isAdmin={isAdmin}
              divergenceCount={divergenceCount}
              ceCoverage={ceCoverage}
              onAddPod={onAddPod}
              onEditPod={onEditPod}
              onOmitPod={(pod) => setOmitTarget(pod)}
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
              routeCeMasters={routeCeMasters}
              divergenceCount={divergenceCount}
              ceCoverage={ceCoverage}
              estadoMeta={estadoMeta}
              onEditPol={onEditPol}
            />
          ) : null}
          {activeTab === 'adr' ? (
            <VoyageAgencyReportTab
              voyageId={voyage.id}
              voyageLabel={voyageLabel}
              carrierName={voyage.vessel?.carrier?.name ?? 'Armador não informado'}
              pods={adrPods}
              initialEscala={initialEscala}
            />
          ) : null}
        </div>
      </section>
      {omitTarget ? (
        <OmitEscalaModal
          open
          onClose={() => setOmitTarget(null)}
          voyageId={voyage.id}
          omittedPod={omitTarget}
          candidateDischargePods={activePods.length > 1 ? activePods.filter((pod) => pod !== omitTarget) : activePods}
        />
      ) : null}
      <TransshipmentPanel voyageId={voyage.id} />
    </Card>
  )
}
