import { Link } from 'react-router-dom'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import type { BlDisposition, VoyageOmission } from '../../services/transshipments'

export function BlTransshipmentCard({ omission, disposition, saving, onCod, onRestore }: {
  omission: VoyageOmission
  disposition: BlDisposition
  saving: boolean
  onCod: () => void
  onRestore: () => void
}) {
  const values = [omission.onwardVesselName, omission.onwardCarrier, omission.onwardVoyageNumber, omission.onwardEtd?.slice(0, 10), omission.onwardEta?.slice(0, 10)]
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Transbordo / COD</h3>
        <span className="rounded-full bg-[var(--app-surface-muted)] px-2 py-1 text-xs font-semibold uppercase">
          {disposition === 'cod' ? `COD ${omission.dischargePod}` : 'Transbordo'}
        </span>
      </div>
      <p className="mt-2 text-xs text-[var(--app-muted)]">Escala omitida em {omission.omittedPod}; descarga em {omission.dischargePod}.</p>
      <p className="mt-2 text-sm">
        {values.map((value, index) => <span key={`${value ?? 'empty'}-${index}`}>{index ? ' · ' : ''}{value || '—'}</span>)}
      </p>
      <Link className="mt-2 inline-block text-xs font-semibold text-[#58a6ff] hover:underline" to={`/viagens/${omission.voyageId}`}>
        Registro global da omissão →
      </Link>
      <div className="mt-3">
        {disposition === 'transshipment' ? (
          <Button variant="secondary" className="app-btn--sm" disabled={saving} onClick={onCod}>Marcar COD</Button>
        ) : (
          <Button variant="secondary" className="app-btn--sm" loading={saving} onClick={onRestore}>Reverter para transbordo</Button>
        )}
      </div>
    </Card>
  )
}
