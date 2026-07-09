import { useState, type FormEvent } from 'react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useAuth } from '../../hooks/useAuth'
import { useOmitEscala } from '../../hooks/useTransshipments'

type OmitEscalaModalProps = {
  open: boolean
  onClose: () => void
  voyageId: number
  omittedPod: string
  candidateDischargePods: string[]
}

export function OmitEscalaModal({
  open,
  onClose,
  voyageId,
  omittedPod,
  candidateDischargePods,
}: OmitEscalaModalProps) {
  const { user } = useAuth()
  const omit = useOmitEscala(voyageId)
  const [dischargePod, setDischargePod] = useState(candidateDischargePods[0] ?? '')
  const [reason, setReason] = useState('')
  const [prevTarget, setPrevTarget] = useState<string | null>(null)

  if (open && omittedPod !== prevTarget) {
    setPrevTarget(omittedPod)
    setDischargePod(candidateDischargePods[0] ?? '')
    setReason('')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user?.id || !dischargePod) return
    await omit.mutateAsync({
      voyageId,
      omittedPod,
      dischargePod,
      reason: reason.trim() || null,
      changedBy: user.id,
    })
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={`Omitir escala de ${omittedPod}`}>
      <form className="grid gap-4" onSubmit={handleSubmit}>
        <div className="app-panel app-panel--padded text-sm">
          A carga de {omittedPod} sera descarregada no porto escolhido e entrara em transbordo por B/L.
        </div>
        <Field label="Porto de descarga">
          <select className="app-input" value={dischargePod} onChange={(event) => setDischargePod(event.target.value)} required>
            {candidateDischargePods.map((pod) => (
              <option key={pod} value={pod}>
                {pod}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Motivo (opcional)">
          <Input value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        {omit.isError ? <p className="text-sm text-red-500">Falha ao omitir a escala.</p> : null}
        <div className="app-modal__actions">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={omit.isPending} type="submit" disabled={!dischargePod}>
            Omitir escala
          </Button>
        </div>
      </form>
    </Modal>
  )
}
