import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Field, Input, Select } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import {
  initialVoyageFormValues,
  normalizeVoyageFormValues,
  voyageFormSchema,
  type VoyageFormErrors,
  type VoyageFormValues,
} from '../../services/voyageForm'
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
  const { user } = useAuth()
  const [form, setForm] = useState<VoyageFormValues>(initialVoyageFormValues)
  const [hasIndicatedFirstPort, setHasIndicatedFirstPort] = useState(false)
  const [errors, setErrors] = useState<VoyageFormErrors>({})
  const [saving, setSaving] = useState(false)

  // Re-baseia o formulário quando o modal abre ou os valores iniciais mudam —
  // ajuste durante o render (sem useEffect), mantendo o gatilho original.
  const [prevReset, setPrevReset] = useState<{ open: boolean; initialValues?: Partial<VoyageFormValues> }>({ open })
  if (open !== prevReset.open || initialValues !== prevReset.initialValues) {
    setPrevReset({ open, initialValues })
    if (open) {
      const indicatedPort = initialValues?.indicatedFirstBrazilianPort ?? initialVoyageFormValues.indicatedFirstBrazilianPort
      const indicatedEta = initialValues?.indicatedFirstBrazilianEta ?? initialVoyageFormValues.indicatedFirstBrazilianEta
      setForm({
        ...initialVoyageFormValues,
        ...initialValues,
        indicatedFirstBrazilianPort: indicatedPort,
        indicatedFirstBrazilianEta: indicatedEta,
        loadPortEtds: initialValues?.loadPortEtds ?? initialVoyageFormValues.loadPortEtds,
        dischargePortEtas: initialValues?.dischargePortEtas ?? initialVoyageFormValues.dischargePortEtas,
      })
      setHasIndicatedFirstPort(Boolean(indicatedPort || indicatedEta))
      setErrors({})
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const normalizedForm = normalizeVoyageFormValues(form)
    const result = voyageFormSchema.safeParse(normalizedForm)
    if (!result.success) {
      const fieldErrors: VoyageFormErrors = {}
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof VoyageFormValues
        if (!fieldErrors[field]) fieldErrors[field] = issue.message
      }
      setErrors(fieldErrors)
      return
    }

    setErrors({})
    setSaving(true)

    try {
      const saved = voyageId
        ? await updateVoyage(voyageId, normalizedForm, user?.id ?? null)
        : await createVoyage(normalizedForm, user?.id ?? null)

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
        queryClient.invalidateQueries({ queryKey: ['voyage-options'] }),
        queryClient.invalidateQueries({ queryKey: ['voyage-pod-schedules'] }),
        queryClient.invalidateQueries({ queryKey: ['voyage-escala-schedules'] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] }),
      ])

      showToast(voyageId ? 'Viagem atualizada com sucesso.' : 'Viagem cadastrada com sucesso.', 'success')
      onSaved?.(saved.id)
      onClose()
      setForm(initialVoyageFormValues)
    } catch {
      showToast(
        voyageId
          ? 'Falha ao atualizar viagem. Revise os dados e tente novamente.'
          : 'Falha ao cadastrar viagem. Revise os dados e tente novamente.',
        'error',
      )
    } finally {
      setSaving(false)
    }
  }

  function updateDischargePort(index: number, field: 'pod' | 'eta', value: string) {
    setForm((current) => ({
      ...current,
      dischargePortEtas: current.dischargePortEtas.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: field === 'pod' ? value.toUpperCase() : value } : row,
      ),
    }))
  }

  function updateLoadPort(index: number, field: 'pol' | 'etd', value: string) {
    setForm((current) => ({
      ...current,
      loadPortEtds: current.loadPortEtds.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: field === 'pol' ? value.toUpperCase() : value } : row,
      ),
    }))
  }

  function addLoadPort() {
    setForm((current) => ({
      ...current,
      loadPortEtds: [...current.loadPortEtds, { pol: '', etd: '' }],
    }))
  }

  function removeLoadPort(index: number) {
    setForm((current) => ({
      ...current,
      loadPortEtds: current.loadPortEtds.filter((_, rowIndex) => rowIndex !== index),
    }))
  }

  function addDischargePort() {
    setForm((current) => ({
      ...current,
      dischargePortEtas: [...current.dischargePortEtas, { pod: '', eta: '' }],
    }))
  }

  function removeDischargePort(index: number) {
    setForm((current) => ({
      ...current,
      dischargePortEtas: current.dischargePortEtas.filter((_, rowIndex) => rowIndex !== index),
    }))
  }

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form className="grid gap-4" onSubmit={handleSubmit}>
        <div className="app-panel app-panel--padded text-sm">
          {note ??
            'Cadastre a viagem e, se desejar antecipar a exibição no Line-Up, informe os portos de descarga com seus ETAs antes da chegada dos manifestos.'}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Armador" error={errors.carrierName}>
            <Input
              value={form.carrierName}
              onChange={(event) => setForm((current) => ({ ...current, carrierName: event.target.value }))}
            />
          </Field>
          <Field label="SCAC">
            <Input
              value={form.carrierScac}
              onChange={(event) => setForm((current) => ({ ...current, carrierScac: event.target.value.toUpperCase() }))}
            />
          </Field>
          <Field label="Navio" error={errors.vesselName}>
            <Input
              value={form.vesselName}
              onChange={(event) => setForm((current) => ({ ...current, vesselName: event.target.value.toUpperCase() }))}
            />
          </Field>
          <Field label="IMO">
            <Input
              value={form.vesselImo}
              onChange={(event) => setForm((current) => ({ ...current, vesselImo: event.target.value }))}
            />
          </Field>
          <Field label="Numero da viagem" error={errors.voyageNumber}>
            <Input
              value={form.voyageNumber}
              onChange={(event) => setForm((current) => ({ ...current, voyageNumber: event.target.value.toUpperCase() }))}
            />
          </Field>
          <Field label="Status">
            <Select
              value={form.status}
              onChange={(event) =>
                setForm((current) => ({ ...current, status: event.target.value as VoyageFormValues['status'] }))
              }
            >
              <option value="active">Ativa</option>
              <option value="completed">Concluida</option>
              {form.status === 'cancelled' ? <option value="cancelled" disabled>Cancelada</option> : null}
            </Select>
          </Field>
        </div>

        <div className="app-panel app-panel--padded grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="app-panel__title">1º Porto Brasileiro (Âncora D−7 / D−5)</div>
              <div className="app-panel__meta">
                Por padrão, a âncora de prazos é o menor ETA das escalas próprias. Ative para indicar outro 1º porto brasileiro com ETA anterior.
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--app-text)] font-medium">
              <input
                type="checkbox"
                checked={hasIndicatedFirstPort}
                onChange={(event) => {
                  const checked = event.target.checked
                  setHasIndicatedFirstPort(checked)
                  if (!checked) {
                    setForm((current) => ({
                      ...current,
                      indicatedFirstBrazilianPort: null,
                      indicatedFirstBrazilianEta: null,
                    }))
                  }
                }}
                className="h-4 w-4 rounded border-slate-500 accent-amber-500"
              />
              Indicar outro 1º porto brasileiro
            </label>
          </div>

          {hasIndicatedFirstPort ? (
            <div className="grid gap-3 md:grid-cols-2 pt-2 border-t border-[var(--app-border)]">
              <Field label="Porto indicado" error={errors.indicatedFirstBrazilianPort}>
                <Input
                  value={form.indicatedFirstBrazilianPort ?? ''}
                  placeholder="Ex.: BRSSZ"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      indicatedFirstBrazilianPort: event.target.value.toUpperCase(),
                    }))
                  }
                />
              </Field>
              <Field label="ETA indicado" error={errors.indicatedFirstBrazilianEta}>
                <Input
                  type="date"
                  value={form.indicatedFirstBrazilianEta ?? ''}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      indicatedFirstBrazilianEta: event.target.value,
                    }))
                  }
                />
              </Field>
            </div>
          ) : null}
        </div>

        <div className="app-panel app-panel--padded grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="app-panel__title">Portos de carregamento (POL)</div>
              <div className="app-panel__meta">
                Informe ETDs para rotas que devem nascer manualmente antes dos manifestos.
              </div>
            </div>
            <Button variant="secondary" type="button" onClick={addLoadPort}>
              <Plus size={15} />
              Adicionar porto
            </Button>
          </div>

          {errors.loadPortEtds ? (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errors.loadPortEtds}
            </div>
          ) : null}

          {form.loadPortEtds.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--app-border-strong)] px-3 py-4 text-sm text-[var(--app-muted)]">
              Nenhum porto de carregamento planejado. Adicione linhas se precisar informar ETD manualmente.
            </div>
          ) : null}

          <div className="grid gap-3">
            {form.loadPortEtds.map((row, index) => (
              <div key={`load-port-${index}`} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]">
                <Field label={`Porto de carregamento ${index + 1}`}>
                  <Input
                    value={row.pol}
                    placeholder="Ex.: CNTAO"
                    onChange={(event) => updateLoadPort(index, 'pol', event.target.value)}
                  />
                </Field>
                <Field label="ETD">
                  <Input
                    type="date"
                    value={row.etd}
                    onChange={(event) => updateLoadPort(index, 'etd', event.target.value)}
                  />
                </Field>
                <div className="flex items-end">
                  <Button variant="danger" type="button" onClick={() => removeLoadPort(index)}>
                    <Trash2 size={15} />
                    Remover
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="app-panel app-panel--padded grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="app-panel__title">Portos de descarga para o Line-Up</div>
              <div className="app-panel__meta">
                Informe um ETA para cada POD que precisa aparecer no quadro antes da importação dos manifestos.
              </div>
            </div>
            <Button variant="secondary" type="button" onClick={addDischargePort}>
              <Plus size={15} />
              Adicionar porto
            </Button>
          </div>

          {errors.dischargePortEtas ? (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errors.dischargePortEtas}
            </div>
          ) : null}

          {form.dischargePortEtas.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--app-border-strong)] px-3 py-4 text-sm text-[var(--app-muted)]">
              Nenhum porto de descarga planejado. Adicione linhas se a viagem precisar entrar no Line-Up antes dos manifestos.
            </div>
          ) : null}

          <div className="grid gap-3">
            {form.dischargePortEtas.map((row, index) => (
              <div key={`discharge-port-${index}`} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]">
                <Field label={`Porto de descarga ${index + 1}`}>
                  <Input
                    value={row.pod}
                    placeholder="Ex.: SANTOS"
                    onChange={(event) => updateDischargePort(index, 'pod', event.target.value)}
                  />
                </Field>
                <Field label="ETA">
                  <Input
                    type="date"
                    value={row.eta}
                    onChange={(event) => updateDischargePort(index, 'eta', event.target.value)}
                  />
                </Field>
                <div className="flex items-end">
                  <Button variant="danger" type="button" onClick={() => removeDischargePort(index)}>
                    <Trash2 size={15} />
                    Remover
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="app-modal__actions">
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
