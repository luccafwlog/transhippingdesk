import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input, Select } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { deleteVaziosReorgRate, listVaziosReorgRates, upsertVaziosReorgRate } from '../services/vaziosExportOperations'
import { formatBRL, formatDate } from '../lib/utils'
import type { VaziosReorgRate, VaziosReorgServiceType } from '../types/database'

const SERVICE_LABELS: Record<VaziosReorgServiceType, string> = {
  bundle: 'Bundle',
  desova: 'Desova',
  visual_check: 'Visual check',
}

type Form = {
  id?: string
  service: VaziosReorgServiceType
  rate_brl: number
  active: boolean
  valid_from: string
  valid_to: string
}

const EMPTY_FORM: Form = { service: 'bundle', rate_brl: 0, active: true, valid_from: new Date().toISOString().slice(0, 10), valid_to: '' }

export function VaziosReorgRates() {
  const queryClient = useQueryClient()
  const { isAdmin } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<Form>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const { data: rates, isLoading, error } = useQuery({ queryKey: ['vazios-reorg-rates'], queryFn: listVaziosReorgRates })

  function openNew() {
    setForm({ ...EMPTY_FORM })
    setModalOpen(true)
  }

  function openEdit(rate: VaziosReorgRate) {
    setForm({ id: rate.id, service: rate.service as VaziosReorgServiceType, rate_brl: Number(rate.rate_brl), active: rate.active, valid_from: rate.valid_from, valid_to: rate.valid_to ?? '' })
    setModalOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      await upsertVaziosReorgRate({ id: form.id, service: form.service, rate_brl: Number(form.rate_brl), active: form.active, valid_from: form.valid_from, valid_to: form.valid_to || null })
      await queryClient.invalidateQueries({ queryKey: ['vazios-reorg-rates'] })
      showToast('Tarifa salva.', 'success')
      setModalOpen(false)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao salvar tarifa.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!(await confirm({ message: 'Excluir esta tarifa?', tone: 'danger', confirmLabel: 'Excluir' }))) return
    setDeletingId(id)
    try {
      await deleteVaziosReorgRate(id)
      await queryClient.invalidateQueries({ queryKey: ['vazios-reorg-rates'] })
      showToast('Tarifa excluída.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao excluir tarifa.', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Tarifas de Reorganização — Vazios"
        description="Tarifa vigente por serviço (bundle, desova, visual check) usada na operação da escala de Vazios — Exportação. Valor aplicado como quantidade × tarifa."
        action={isAdmin ? (
          <Button onClick={openNew}>
            <Plus size={16} />
            Nova tarifa
          </Button>
        ) : null}
      />

      <Card className="overflow-hidden p-0">
        {error ? <InlineError message="Erro ao carregar tarifas." /> : null}
        <div className="app-table-scroll">
          <table className="app-table app-table--compact w-full text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className="px-4 py-3">Serviço</th>
                <th scope="col" className="px-4 py-3">Tarifa (BRL)</th>
                <th scope="col" className="px-4 py-3">Vigência</th>
                <th scope="col" className="px-4 py-3">Ativa</th>
                {isAdmin ? <th scope="col" className="px-4 py-3">Ações</th> : null}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={isAdmin ? 5 : 4} className="px-4 py-4 text-[var(--app-muted)]">Carregando…</td></tr>
              ) : (rates ?? []).length === 0 ? (
                <tr><td colSpan={isAdmin ? 5 : 4} className="px-4 py-4 text-[var(--app-muted)]">Nenhuma tarifa cadastrada. Sem tarifa ativa, os serviços de reorganização aparecem como "Sem tarifa" na operação da escala.</td></tr>
              ) : (rates ?? []).map((rate) => (
                <tr key={rate.id}>
                  <td className="px-4 py-3 font-medium">{SERVICE_LABELS[rate.service as VaziosReorgServiceType] ?? rate.service}</td>
                  <td className="px-4 py-3">{formatBRL(Number(rate.rate_brl))}</td>
                  <td className="px-4 py-3">{formatDate(rate.valid_from)}{rate.valid_to ? ` — ${formatDate(rate.valid_to)}` : ' — sem término'}</td>
                  <td className="px-4 py-3">{rate.active ? 'Sim' : 'Não'}</td>
                  {isAdmin ? (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Button variant="secondary" onClick={() => openEdit(rate)}>Editar</Button>
                        <Button variant="danger" onClick={() => void handleDelete(rate.id)} loading={deletingId === rate.id} aria-label={`Excluir tarifa de ${SERVICE_LABELS[rate.service as VaziosReorgServiceType] ?? rate.service}`}>
                          <Trash2 size={15} />
                        </Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={modalOpen} title={form.id ? 'Editar tarifa' : 'Nova tarifa'} onClose={() => setModalOpen(false)}>
        <div className="grid gap-3">
          <Field label="Serviço">
            <Select value={form.service} onChange={(event) => setForm((f) => ({ ...f, service: event.target.value as VaziosReorgServiceType }))}>
              {(Object.entries(SERVICE_LABELS) as Array<[VaziosReorgServiceType, string]>).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Tarifa (BRL)">
            <Input type="number" min={0} step="0.01" value={form.rate_brl} onChange={(event) => setForm((f) => ({ ...f, rate_brl: Number(event.target.value) }))} />
          </Field>
          <Field label="Vigência inicial">
            <Input type="date" value={form.valid_from} onChange={(event) => setForm((f) => ({ ...f, valid_from: event.target.value }))} />
          </Field>
          <Field label="Vigência final (opcional)">
            <Input type="date" value={form.valid_to} onChange={(event) => setForm((f) => ({ ...f, valid_to: event.target.value }))} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} onChange={(event) => setForm((f) => ({ ...f, active: event.target.checked }))} />
            Ativa
          </label>
          <Button onClick={() => void handleSave()} loading={saving}>Salvar</Button>
        </div>
      </Modal>
    </>
  )
}
