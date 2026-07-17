import { useState, type FormEvent } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useUpdateVoyageOmission, useVoyageTransshipments } from '../../hooks/useTransshipments'
import type { VoyageOmission } from '../../services/transshipments'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'

const display = (value: string | null) => value?.trim() || '—'
const displayDate = (value: string | null) => value ? new Intl.DateTimeFormat('pt-BR').format(new Date(value)) : '—'

export function TransshipmentInfoCard({ voyageId }: { voyageId: number }) {
  const { data } = useVoyageTransshipments(voyageId)
  if (!data?.omissions.length) return null

  return (
    <section className="grid gap-3 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4">
      <h3 className="text-sm font-semibold text-[var(--app-text-strong)]">Informações de Transbordo</h3>
      {data.omissions.map((omission) => <OmissionInfo key={omission.id} voyageId={voyageId} omission={omission} />)}
    </section>
  )
}

function OmissionInfo({ voyageId, omission }: { voyageId: number; omission: VoyageOmission }) {
  const { user } = useAuth()
  const update = useUpdateVoyageOmission(voyageId)
  const [editing, setEditing] = useState(false)
  const [vessel, setVessel] = useState(omission.onwardVesselName ?? '')
  const [carrier, setCarrier] = useState(omission.onwardCarrier ?? '')
  const [voyageNumber, setVoyageNumber] = useState(omission.onwardVoyageNumber ?? '')
  const [etd, setEtd] = useState(omission.onwardEtd?.slice(0, 10) ?? '')
  const [eta, setEta] = useState(omission.onwardEta?.slice(0, 10) ?? '')
  const [reason, setReason] = useState(omission.reason ?? '')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!user?.id) return
    await update.mutateAsync({
      omissionId: omission.id,
      onwardVesselName: vessel.trim() || null,
      onwardCarrier: carrier.trim() || null,
      onwardVoyageNumber: voyageNumber.trim() || null,
      onwardEtd: etd || null,
      onwardEta: eta || null,
      reason: reason.trim() || null,
      changedBy: user.id,
    })
    setEditing(false)
  }

  return (
    <div className="grid gap-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">{omission.omittedPod} · Porto de Transbordo — {omission.dischargePod}</div>
        {!editing ? <Button variant="secondary" className="app-btn--sm" onClick={() => setEditing(true)}>Complementar</Button> : null}
      </div>
      {editing ? (
        <form className="grid gap-3 md:grid-cols-2" onSubmit={submit}>
          <Field label="Navio de Transbordo"><Input value={vessel} onChange={(event) => setVessel(event.target.value)} /></Field>
          <Field label="Armador de Transbordo"><Input value={carrier} onChange={(event) => setCarrier(event.target.value)} /></Field>
          <Field label="Viagem de Transbordo"><Input value={voyageNumber} onChange={(event) => setVoyageNumber(event.target.value)} /></Field>
          <Field label="Motivo"><Input value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
          <Field label="ETD de Transbordo"><Input type="date" value={etd} onChange={(event) => setEtd(event.target.value)} /></Field>
          <Field label="ETA de Transbordo"><Input type="date" value={eta} onChange={(event) => setEta(event.target.value)} /></Field>
          <div className="flex gap-2 md:col-span-2">
            <Button type="submit" loading={update.isPending}>Salvar informações</Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>Cancelar</Button>
          </div>
        </form>
      ) : (
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Info label="Navio" value={display(omission.onwardVesselName)} />
          <Info label="Armador" value={display(omission.onwardCarrier)} />
          <Info label="Viagem" value={display(omission.onwardVoyageNumber)} />
          <Info label="ETD" value={displayDate(omission.onwardEtd)} />
          <Info label="ETA" value={displayDate(omission.onwardEta)} />
          <Info label="Motivo" value={display(omission.reason)} />
        </dl>
      )}
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-[var(--app-muted)]">{label}</dt><dd className="font-medium text-[var(--app-text-strong)]">{value}</dd></div>
}
