import { useEffect, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../ui/Button'
import { Field, Input, Select } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { createVoyage, initialVoyageFormValues, type VoyageFormValues } from '../../services/voyages'

export function VoyageCreateModal({
  open,
  onClose,
  onCreated,
  title = 'Nova Viagem',
  initialValues,
}: {
  open: boolean
  onClose: () => void
  onCreated?: (voyageId: number) => void
  title?: string
  initialValues?: Partial<VoyageFormValues>
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
      const created = await createVoyage(form)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
        queryClient.invalidateQueries({ queryKey: ['voyage-options'] }),
      ])

      showToast('Viagem cadastrada com sucesso.', 'success')
      onCreated?.(created.id)
      onClose()
      setForm(initialVoyageFormValues)
    } catch {
      showToast('Falha ao cadastrar viagem. Revise os dados e tente novamente.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form className="grid gap-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Armador">
            <Input value={form.carrierName} onChange={(event) => setForm((current) => ({ ...current, carrierName: event.target.value }))} required />
          </Field>
          <Field label="SCAC">
            <Input value={form.carrierScac} onChange={(event) => setForm((current) => ({ ...current, carrierScac: event.target.value.toUpperCase() }))} />
          </Field>
          <Field label="Navio">
            <Input value={form.vesselName} onChange={(event) => setForm((current) => ({ ...current, vesselName: event.target.value.toUpperCase() }))} required />
          </Field>
          <Field label="IMO">
            <Input value={form.vesselImo} onChange={(event) => setForm((current) => ({ ...current, vesselImo: event.target.value }))} />
          </Field>
          <Field label="Número da viagem">
            <Input value={form.voyageNumber} onChange={(event) => setForm((current) => ({ ...current, voyageNumber: event.target.value.toUpperCase() }))} required />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as VoyageFormValues['status'] }))}>
              <option value="active">Ativa</option>
              <option value="completed">Concluída</option>
              <option value="cancelled">Cancelada</option>
            </Select>
          </Field>
          <Field label="POL">
            <Input value={form.polName} onChange={(event) => setForm((current) => ({ ...current, polName: event.target.value }))} required />
          </Field>
          <Field label="UN/LOCODE POL">
            <Input value={form.polLocode} onChange={(event) => setForm((current) => ({ ...current, polLocode: event.target.value.toUpperCase() }))} />
          </Field>
          <Field label="POD">
            <Input value={form.podName} onChange={(event) => setForm((current) => ({ ...current, podName: event.target.value }))} required />
          </Field>
          <Field label="UN/LOCODE POD">
            <Input value={form.podLocode} onChange={(event) => setForm((current) => ({ ...current, podLocode: event.target.value.toUpperCase() }))} />
          </Field>
          <Field label="ETD">
            <Input type="datetime-local" value={form.etd} onChange={(event) => setForm((current) => ({ ...current, etd: event.target.value }))} />
          </Field>
          <Field label="ETA">
            <Input type="datetime-local" value={form.eta} onChange={(event) => setForm((current) => ({ ...current, eta: event.target.value }))} />
          </Field>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={saving} type="submit">
            Cadastrar viagem
          </Button>
        </div>
      </form>
    </Modal>
  )
}
