import { useEffect, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../ui/Button'
import { Field, Input, Select } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { initialVoyageFormValues, type VoyageFormValues } from '../../services/voyageForm'
import { createVoyage, updateVoyage } from '../../services/voyages'

export function VoyageCreateModal({
  open,
  onClose,
  onSaved,
  title = 'Nova Viagem',
  initialValues,
  note,
  voyageId,
}: {
  open: boolean
  onClose: () => void
  onSaved?: (voyageId: number) => void
  title?: string
  initialValues?: Partial<VoyageFormValues>
  note?: string
  voyageId?: number
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [form, setForm] = useState<VoyageFormValues>(initialVoyageFormValues)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm({ ...initialVoyageFormValues, ...initialValues })
  }, [initialValues, open])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)

    try {
      const saved = voyageId ? await updateVoyage(voyageId, form) : await createVoyage(form)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
        queryClient.invalidateQueries({ queryKey: ['voyage-options'] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
      ])

      showToast(voyageId ? 'Viagem atualizada com sucesso.' : 'Viagem cadastrada com sucesso.', 'success')
      onSaved?.(saved.id)
      onClose()
      setForm(initialVoyageFormValues)
    } catch {
      showToast(voyageId ? 'Falha ao atualizar viagem. Revise os dados e tente novamente.' : 'Falha ao cadastrar viagem. Revise os dados e tente novamente.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form className="grid gap-4" onSubmit={handleSubmit}>
        <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-sm text-slate-300">
          {note ?? 'A viagem representa o navio/viagem. Os trechos POL/POD ficam em cada manifesto importado.'}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Armador">
            <Input
              value={form.carrierName}
              onChange={(event) => setForm((current) => ({ ...current, carrierName: event.target.value }))}
              required
            />
          </Field>
          <Field label="SCAC">
            <Input
              value={form.carrierScac}
              onChange={(event) => setForm((current) => ({ ...current, carrierScac: event.target.value.toUpperCase() }))}
            />
          </Field>
          <Field label="Navio">
            <Input
              value={form.vesselName}
              onChange={(event) => setForm((current) => ({ ...current, vesselName: event.target.value.toUpperCase() }))}
              required
            />
          </Field>
          <Field label="IMO">
            <Input
              value={form.vesselImo}
              onChange={(event) => setForm((current) => ({ ...current, vesselImo: event.target.value }))}
            />
          </Field>
          <Field label="Numero da viagem">
            <Input
              value={form.voyageNumber}
              onChange={(event) => setForm((current) => ({ ...current, voyageNumber: event.target.value.toUpperCase() }))}
              required
            />
          </Field>
          <Field label="Status">
            <Select
              value={form.status}
              onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as VoyageFormValues['status'] }))}
            >
              <option value="active">Ativa</option>
              <option value="completed">Concluida</option>
              <option value="cancelled">Cancelada</option>
            </Select>
          </Field>
          <Field label="ETD">
            <Input
              type="datetime-local"
              value={form.etd}
              onChange={(event) => setForm((current) => ({ ...current, etd: event.target.value }))}
            />
          </Field>
          <Field label="ETA">
            <Input
              type="datetime-local"
              value={form.eta}
              onChange={(event) => setForm((current) => ({ ...current, eta: event.target.value }))}
            />
          </Field>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={saving} type="submit">
            {voyageId ? 'Salvar viagem' : 'Cadastrar viagem'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
