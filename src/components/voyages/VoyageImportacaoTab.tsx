import { Info, MetricPanel, MetricSection } from '../shared/VoyageSectionCards'
import { VoyageImportActions } from '../shared/VoyageImportActions'
import type { VoyageVehicleStat } from '../../hooks/useVehicles'
import type { VoyageVaziosImportacaoStat } from '../../hooks/useVaziosImportacaoStats'
import { formatMetric, formatPortDisplayName } from '../../lib/voyageFormat'
import { summarizeImportByPod } from '../../services/voyageSummaries'
import type { Voyage } from './voyageCardTypes'

export function VoyageImportacaoTab({
  voyage,
  voyageLabel,
  vehicleStats,
  vaziosImpStats,
  userId,
}: {
  voyage: Voyage
  voyageLabel: string
  vehicleStats: VoyageVehicleStat
  vaziosImpStats: VoyageVaziosImportacaoStat
  userId: string | undefined
}) {
  const importByPod = summarizeImportByPod(voyage.bls, vehicleStats.containerNumbers)

  return (
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
                  <MetricPanel title="Veículos">
                    <Info label="Containers com veiculos" value={String(pod.vehicles.distinctContainers)} />
                    <Info label="Carga geral (CNTRs)" value={String(pod.generalCargo.distinct)} />
                  </MetricPanel>
                ) : null}
                {pod.breakbulk.bls ? (
                  <MetricPanel title="Carga solta">
                    <Info label="B/Ls carga solta" value={String(pod.breakbulk.bls)} />
                    <Info label="Máquinas" value={formatMetric(pod.breakbulk.machines)} />
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

      {userId ? (
        <MetricSection
          title="Importação rápida"
          description="Importe manifestos e planilhas diretamente nesta viagem sem sair da tela."
        >
          <VoyageImportActions
            voyageId={voyage.id}
            voyageLabel={voyageLabel}
            userId={userId}
            types={['bb', 'vaziosImp', 'vehicles', 'baplie', 'blFreight']}
          />
        </MetricSection>
      ) : null}
    </>
  )
}
