import { Info, MetricPanel, MetricSection } from '../shared/VoyageSectionCards'
import { VoyageImportActions } from '../shared/VoyageImportActions'
import { formatMetric } from '../../lib/voyageFormat'
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
  const graniteTotals = exportByPol.reduce(
    (totals, pol) => ({
      manifests: totals.manifests + pol.granite.manifests,
      bls: totals.bls + pol.granite.bls,
      weightTon: totals.weightTon + pol.granite.weightTon,
      readyForBilling: totals.readyForBilling + pol.granite.readyForBilling,
      invoiced: totals.invoiced + pol.granite.invoiced,
    }),
    { manifests: 0, bls: 0, weightTon: 0, readyForBilling: 0, invoiced: 0 },
  )
  const emptyBookings = (voyage.vazios_manifests ?? []).flatMap((manifest) => manifest.vazios_bookings ?? [])
  const emptyTypes = Array.from(new Set(emptyBookings.map((booking) => booking.container_type?.trim()).filter(Boolean))).join(', ')
  const emptyTotals = {
    units: (voyage.vazios_manifests ?? []).reduce(
      (sum, manifest) => sum + Number(manifest.total_bookings ?? manifest.vazios_bookings?.length ?? 0),
      0,
    ),
    distinctContainers: (voyage.vazios_manifests ?? []).reduce(
      (sum, manifest) => sum + Number(manifest.total_bookings ?? manifest.vazios_bookings?.length ?? 0),
      0,
    ),
    types: emptyTypes || '-',
  }

  return (
    <>
      {exportByPol.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <MetricPanel title="Granito">
            <Info label="Manifestos" value={String(graniteTotals.manifests)} />
            <Info label="B/Ls" value={String(graniteTotals.bls)} />
            <Info label="Peso total" value={`${formatMetric(graniteTotals.weightTon)} ton`} />
            <Info label="Prontos faturamento" value={String(graniteTotals.readyForBilling)} />
            <Info label="Faturados" value={String(graniteTotals.invoiced)} />
          </MetricPanel>
          <MetricPanel title="Vazios">
            <Info label="Unidades embarcadas" value={String(emptyTotals.units)} />
            <Info label="Containers distintos" value={String(emptyTotals.distinctContainers)} />
            <Info label="Tipos" value={emptyTotals.types} />
          </MetricPanel>
        </div>
      ) : (
        <div className="app-panel app-panel--padded text-sm text-[var(--app-muted)]">
          Nenhuma carga de exportação vinculada a esta viagem.
        </div>
      )}

      {userId ? (
        <MetricSection
          title="Cadastro rápido"
          description="Cadastre manifestos e unidades de exportação diretamente nesta viagem."
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
