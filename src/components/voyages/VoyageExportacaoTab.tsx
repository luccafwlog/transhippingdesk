import { Info, MetricPanel, MetricSection } from '../shared/VoyageSectionCards'
import { VoyageImportActions } from '../shared/VoyageImportActions'
import { formatMetric, formatPortDisplayName } from '../../lib/voyageFormat'
import { summarizeExportByPol } from '../../services/voyageSummaries'
import type { Voyage } from './voyageCardTypes'

export function VoyageExportacaoTab({
  voyage,
  voyageLabel,
  userId,
}: {
  voyage: Voyage
  voyageLabel: string
  userId: string | undefined
}) {
  const exportByPol = summarizeExportByPol(voyage.granite_manifests, voyage.vazios_manifests)

  return (
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
                  <Info label="Unidades embarcadas" value={String(pol.vazios.units)} />
                  <Info label="Containers distintos" value={String(pol.vazios.distinctContainers)} />
                  <Info label="Tipos" value={pol.vazios.types || '-'} />
                  <Info label="Local de origem" value={pol.vazios.origins || '-'} />
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

      {userId ? (
        <MetricSection
          title="Exportação rápida"
          description="Importe manifestos e planilhas de exportação diretamente nesta viagem."
        >
          <VoyageImportActions
            voyageId={voyage.id}
            voyageLabel={voyageLabel}
            userId={userId}
            types={['granite', 'vaziosExp']}
          />
        </MetricSection>
      ) : null}
    </>
  )
}
