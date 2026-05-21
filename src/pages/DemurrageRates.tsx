import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import type { DemurrageRate } from '../types/database'
import { invalidateDemurrageRatesCache } from '../services/demurrage'
import { supabase } from '../services/supabase'

type DemurrageRateForm = Omit<DemurrageRate, 'id' | 'created_at' | 'updated_at'>

const EMPTY_FORM: DemurrageRateForm = {
  container_type: '',
  free_days: 21,
  p1_day_from: 22,
  p1_day_to: 30,
  p1_usd: 0,
  p2_day_from: 31,
  p2_usd: 0,
  valid_from: null,
  valid_to: null,
  active: true,
  notes: null,
}

async function listDemurrageRates(): Promise<DemurrageRate[]> {
  const { data, error } = await supabase
    .from('demurrage_rates')
    .select('*')
    .order('container_type', { ascending: true })
  if (error) throw error
  return (data ?? []) as DemurrageRate[]
}

async function upsertDemurrageRate(rate: Partial<DemurrageRate> & { container_type: string }) {
  const { error } = await supabase.from('demurrage_rates').upsert(rate)
  if (error) throw error
}

async function deleteDemurrageRate(id: number) {
  const { error } = await supabase.from('demurrage_rates').delete().eq('id', id)
  if (error) throw error
}

async function toggleDemurrageRateActive(id: number, active: boolean) {
  const { error } = await supabase.from('demurrage_rates').update({ active }).eq('id', id)
  if (error) throw error
}

export function DemurrageRates() {
  const queryClient = useQueryClient()
  const { isAdmin } = useAuth()
  const { showToast } = useToast()
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<DemurrageRateForm & { id?: number }>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const { data: rates, isLoading, error } = useQuery({
    queryKey: ['demurrage-rates'],
    queryFn: listDemurrageRates,
  })

  function openNew() {
    setForm({ ...EMPTY_FORM })
    setModalOpen(true)
  }

  function openEdit(rate: DemurrageRate) {
    setForm({ ...rate })
    setModalOpen(true)
  }

  function field<K extends keyof DemurrageRateForm>(key: K) {
    return (value: DemurrageRateForm[K]) => setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    if (!form.container_type) {
      showToast('Informe o tipo de container.', 'error')
      return
    }
    setSaving(true)
    try {
      await upsertDemurrageRate(form)
      invalidateDemurrageRatesCache()
      await queryClient.invalidateQueries({ queryKey: ['demurrage-rates'] })
      showToast(form.id ? 'Tarifa atualizada.' : 'Tarifa criada.', 'success')
      setModalOpen(false)
    } catch {
      showToast('Falha ao salvar tarifa.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number) {
    setDeletingId(id)
    try {
      await deleteDemurrageRate(id)
      invalidateDemurrageRatesCache()
      await queryClient.invalidateQueries({ queryKey: ['demurrage-rates'] })
      showToast('Tarifa removida.', 'success')
    } catch {
      showToast('Falha ao remover tarifa.', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleToggleActive(rate: DemurrageRate) {
    try {
      await toggleDemurrageRateActive(rate.id, !rate.active)
      invalidateDemurrageRatesCache()
      await queryClient.invalidateQueries({ queryKey: ['demurrage-rates'] })
    } catch {
      showToast('Falha ao alterar status.', 'error')
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tarifas de Demurrage"
        description="Gerencie os valores de sobrestadia por tipo de container, faixa de dias e vigência."
        action={isAdmin ? (
          <Button onClick={openNew}>
            <Plus size={16} />
            Nova Tarifa
          </Button>
        ) : undefined}
      />

      {error ? <InlineError message="Erro ao carregar tarifas de demurrage." /> : null}

      <Card className="overflow-hidden p-0">
        <div className="app-table-scroll">
          <table className="app-table text-left text-sm">
            <thead>
              <tr>
                <th scope="col">Tipo Container</th>
                <th scope="col">Free Days</th>
                <th scope="col">P1 (dias)</th>
                <th scope="col">P1 USD/dia</th>
                <th scope="col">P2 (dias)</th>
                <th scope="col">P2 USD/dia</th>
                <th scope="col">Vigência</th>
                <th scope="col">Status</th>
                {isAdmin && <th scope="col" className="w-20">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-400">
                    Carregando...
                  </td>
                </tr>
              )}
              {!isLoading && !rates?.length && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-400">
                    Nenhuma tarifa cadastrada.
                  </td>
                </tr>
              )}
              {(rates ?? []).map((rate) => (
                <tr key={rate.id}>
                  <td className="font-mono font-semibold">{rate.container_type}</td>
                  <td>{rate.free_days}</td>
                  <td>
                    {rate.p1_day_from}–{rate.p1_day_to}
                  </td>
                  <td>$ {Number(rate.p1_usd).toFixed(2)}</td>
                  <td>{rate.p2_day_from}+</td>
                  <td>$ {Number(rate.p2_usd).toFixed(2)}</td>
                  <td className="text-slate-300">
                    {rate.valid_from ?? '—'} {rate.valid_to ? `→ ${rate.valid_to}` : ''}
                  </td>
                  <td>
                    {isAdmin ? (
                      <button onClick={() => handleToggleActive(rate)} className="cursor-pointer">
                        <Badge tone={rate.active ? 'green' : 'slate'}>{rate.active ? 'Ativo' : 'Inativo'}</Badge>
                      </button>
                    ) : (
                      <Badge tone={rate.active ? 'green' : 'slate'}>{rate.active ? 'Ativo' : 'Inativo'}</Badge>
                    )}
                  </td>
                  {isAdmin && (
                    <td>
                      <div className="flex gap-2">
                        <button
                          onClick={() => openEdit(rate)}
                          className="text-slate-400 hover:text-white"
                          title="Editar"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => handleDelete(rate.id)}
                          disabled={deletingId === rate.id}
                          className="text-red-400 hover:text-red-300 disabled:opacity-40"
                          title="Excluir"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? 'Editar Tarifa' : 'Nova Tarifa'}>
        <div className="space-y-4">
          <Field label="Tipo de Container (ex: 20GP, 40HC, 40RF)">
            <Input
              value={form.container_type}
              onChange={(e) => field('container_type')(e.target.value.toUpperCase())}
              placeholder="20GP"
            />
          </Field>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Free Days">
              <Input
                type="number"
                value={String(form.free_days)}
                onChange={(e) => field('free_days')(Number(e.target.value))}
              />
            </Field>
            <Field label="P1 Início (dia)">
              <Input
                type="number"
                value={String(form.p1_day_from)}
                onChange={(e) => field('p1_day_from')(Number(e.target.value))}
              />
            </Field>
            <Field label="P1 Fim (dia)">
              <Input
                type="number"
                value={String(form.p1_day_to)}
                onChange={(e) => field('p1_day_to')(Number(e.target.value))}
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="P1 USD/dia">
              <Input
                type="number"
                value={String(form.p1_usd)}
                onChange={(e) => field('p1_usd')(Number(e.target.value))}
              />
            </Field>
            <Field label="P2 Início (dia)">
              <Input
                type="number"
                value={String(form.p2_day_from)}
                onChange={(e) => field('p2_day_from')(Number(e.target.value))}
              />
            </Field>
            <Field label="P2 USD/dia">
              <Input
                type="number"
                value={String(form.p2_usd)}
                onChange={(e) => field('p2_usd')(Number(e.target.value))}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Válido de">
              <Input
                type="date"
                value={form.valid_from ?? ''}
                onChange={(e) => field('valid_from')(e.target.value || null)}
              />
            </Field>
            <Field label="Válido até">
              <Input
                type="date"
                value={form.valid_to ?? ''}
                onChange={(e) => field('valid_to')(e.target.value || null)}
              />
            </Field>
          </div>
          <Field label="Observações">
            <Input
              value={form.notes ?? ''}
              onChange={(e) => field('notes')(e.target.value || null)}
              placeholder="Opcional"
            />
          </Field>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} loading={saving}>
              Salvar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
