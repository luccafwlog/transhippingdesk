import { Link } from 'react-router-dom'
import { useVoyageTransshipments } from '../../hooks/useTransshipments'
import type { BlTransshipment, VoyageOmission } from '../../services/transshipments'

export function TransshipmentPanel({ voyageId }: { voyageId: number }) {
  const { data } = useVoyageTransshipments(voyageId)
  if (!data || data.omissions.length === 0) return null

  return (
    <section className="grid gap-3 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4">
      <div className="text-sm font-semibold text-[var(--app-text-strong)]">Transbordo e COD</div>
      {data.omissions.map((omission) => (
        <div key={omission.id} className="grid gap-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-3">
          <div className="text-sm font-semibold text-[var(--app-text-strong)]">
            {omission.omittedPod} - descarga em {omission.dischargePod}
          </div>
          <div className="grid gap-2">
            {data.transshipments
              .filter((transshipment) => transshipment.omissionId === omission.id)
              .map((transshipment) => (
                <BlRow
                  key={transshipment.id}
                  transshipment={transshipment}
                  omission={omission}
                  dischargePod={omission.dischargePod}
                />
              ))}
          </div>
        </div>
      ))}
    </section>
  )
}

function BlRow({
  transshipment,
  omission,
  dischargePod,
}: {
  transshipment: BlTransshipment
  omission: VoyageOmission
  dischargePod: string
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-[var(--app-border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link className="font-mono text-sm font-semibold text-[#58a6ff] hover:underline" to={`/manifestos/${transshipment.blId}`}>{transshipment.blId}</Link>
        <span className="rounded-full bg-[var(--app-surface-muted)] px-2 py-1 text-xs font-semibold uppercase text-[var(--app-muted)]">
          {transshipment.disposition === 'cod' ? `COD ${dischargePod}` : 'Transbordo'}
        </span>
      </div>
      {transshipment.disposition === 'transshipment' ? (
        <div className="grid gap-2">
          <p className="text-xs text-[var(--app-muted)]">Os dados de transbordo são herdados do registro global da omissão.</p>
          <p className="text-sm text-[var(--app-text-strong)]">
            {[
              omission.onwardVesselName,
              omission.onwardCarrier,
              omission.onwardVoyageNumber,
              omission.onwardEtd?.slice(0, 10),
              omission.onwardEta?.slice(0, 10),
            ].map((value) => value || '—').join(' · ')}
          </p>
          <p className="text-xs text-[var(--app-muted)]">A disposição (transbordo/COD) é operada na ficha do B/L.</p>
        </div>
      ) : (
        <p className="text-xs text-[var(--app-muted)]">A disposição (transbordo/COD) é operada na ficha do B/L.</p>
      )}
    </div>
  )
}
