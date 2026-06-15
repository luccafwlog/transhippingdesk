import { useState } from 'react'
import { Button } from '../ui/Button'
import { Field, Textarea } from '../ui/Input'
import { InlineError } from '../ui/Card'
import { Modal } from '../ui/Modal'
import { usePortalOpenDispute } from '../../hooks/usePortalDisputes'

type Props = {
  demurrageInvoiceId: number | null
  docNumber: string
  onClose: () => void
}

export function DisputeModal({ demurrageInvoiceId, docNumber, onClose }: Props) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const openDispute = usePortalOpenDispute()
  const open = Boolean(demurrageInvoiceId)

  async function handleSubmit() {
    if (!demurrageInvoiceId) return
    if (!reason.trim()) {
      setError('Informe o motivo da disputa.')
      return
    }
    setError('')
    try {
      await openDispute.mutateAsync({ demurrageInvoiceId, reason: reason.trim() })
      setReason('')
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Falha ao abrir disputa.')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Disputar ${docNumber}`}>
      <div className="grid gap-4">
        <p className="text-sm text-[var(--app-muted)]">
          Descreva o motivo da disputa para a fatura de demurrage <strong>{docNumber}</strong>.
          Sua solicitacao sera analisada pela equipe Transhipping.
        </p>

        <Field label="Motivo da disputa">
          <Textarea
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Descreva detalhadamente o motivo da disputa (dias, valores, condicoes)..."
          />
        </Field>

        {error ? <InlineError message={error} /> : null}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={openDispute.isPending} onClick={handleSubmit}>Abrir disputa</Button>
        </div>
      </div>
    </Modal>
  )
}
