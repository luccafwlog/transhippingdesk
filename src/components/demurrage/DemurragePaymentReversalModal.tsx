import { useState } from 'react'
import { Button } from '../ui/Button'
import { Field, Textarea } from '../ui/Input'
import { Modal } from '../ui/Modal'

export function DemurragePaymentReversalModal({
  open,
  docNumber,
  loading,
  onClose,
  onSubmit,
}: {
  open: boolean
  /**
   * Numero do documento da invoice (`demurrage_invoices.doc_number`). O id da
   * linha nao entra no titulo: o operador nao reconhece "Demurrage #37" numa
   * conversa com o cliente.
   */
  docNumber: string | null
  loading: boolean
  onClose: () => void
  onSubmit: (reason: string) => void
}) {
  const [reason, setReason] = useState('')

  const trimmedReason = reason.trim()

  return (
    <Modal open={open} onClose={onClose} title={`Cancelar baixa de Demurrage${docNumber ? ` ${docNumber}` : ''}`}>
      <div className="space-y-4 p-4">
        <Field label="Justificativa para cancelar a baixa" required>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Descreva o motivo do cancelamento desta baixa."
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Voltar</Button>
          <Button
            variant="danger"
            loading={loading}
            disabled={!trimmedReason}
            onClick={() => onSubmit(trimmedReason)}
          >
            Cancelar baixa
          </Button>
        </div>
      </div>
    </Modal>
  )
}
