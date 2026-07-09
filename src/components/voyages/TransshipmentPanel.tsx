import { useState } from 'react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { useAuth } from '../../hooks/useAuth'
import { useSetBlDisposition, useVoyageTransshipments } from '../../hooks/useTransshipments'
import type { BlTransshipment } from '../../services/transshipments'

export function TransshipmentPanel({ voyageId }: { voyageId: number }) {
  const { user } = useAuth()
  const { data } = useVoyageTransshipments(voyageId)
  const { setTransshipment, setCod } = useSetBlDisposition(voyageId)
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
                  dischargePod={omission.dischargePod}
                  saving={setTransshipment.isPending || setCod.isPending}
                  onCod={() => user?.id && setCod.mutate({ blId: transshipment.blId, omissionId: omission.id, changedBy: user.id })}
                  onSave={(fields) =>
                    user?.id &&
                    setTransshipment.mutate({
                      blId: transshipment.blId,
                      omissionId: omission.id,
                      changedBy: user.id,
                      ...fields,
                    })
                  }
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
  dischargePod,
  saving,
  onCod,
  onSave,
}: {
  transshipment: BlTransshipment
  dischargePod: string
  saving: boolean
  onCod: () => void
  onSave: (fields: {
    onwardVesselName: string | null
    onwardCarrier: string | null
    onwardVoyageNumber: string | null
    onwardEtd: string | null
    onwardEta: string | null
  }) => void
}) {
  const [vessel, setVessel] = useState(transshipment.onwardVesselName ?? '')
  const [carrier, setCarrier] = useState(transshipment.onwardCarrier ?? '')
  const [voyageNumber, setVoyageNumber] = useState(transshipment.onwardVoyageNumber ?? '')
  const [etd, setEtd] = useState(transshipment.onwardEtd?.slice(0, 10) ?? '')
  const [eta, setEta] = useState(transshipment.onwardEta?.slice(0, 10) ?? '')

  return (
    <div className="grid gap-3 rounded-lg border border-[var(--app-border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-sm text-[var(--app-text-strong)]">{transshipment.blId}</span>
        <span className="rounded-full bg-[var(--app-surface-muted)] px-2 py-1 text-xs font-semibold uppercase text-[var(--app-muted)]">
          {transshipment.disposition === 'cod' ? `COD ${dischargePod}` : 'Transbordo'}
        </span>
      </div>
      {transshipment.disposition === 'transshipment' ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Navio terceiro">
            <Input value={vessel} onChange={(event) => setVessel(event.target.value)} />
          </Field>
          <Field label="Armador terceiro">
            <Input value={carrier} onChange={(event) => setCarrier(event.target.value)} />
          </Field>
          <Field label="Viagem">
            <Input value={voyageNumber} onChange={(event) => setVoyageNumber(event.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="ETD">
              <Input type="date" value={etd} onChange={(event) => setEtd(event.target.value)} />
            </Field>
            <Field label="ETA">
              <Input type="date" value={eta} onChange={(event) => setEta(event.target.value)} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2 md:col-span-2">
            <Button
              className="app-btn--sm"
              loading={saving}
              onClick={() =>
                onSave({
                  onwardVesselName: vessel.trim() || null,
                  onwardCarrier: carrier.trim() || null,
                  onwardVoyageNumber: voyageNumber.trim() || null,
                  onwardEtd: etd || null,
                  onwardEta: eta || null,
                })
              }
            >
              Salvar transbordo
            </Button>
            <Button variant="secondary" className="app-btn--sm" disabled={saving} onClick={onCod}>
              Marcar COD
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="secondary"
          className="app-btn--sm justify-self-start"
          loading={saving}
          onClick={() =>
            onSave({
              onwardVesselName: null,
              onwardCarrier: null,
              onwardVoyageNumber: null,
              onwardEtd: null,
              onwardEta: null,
            })
          }
        >
          Reverter para transbordo
        </Button>
      )}
    </div>
  )
}
