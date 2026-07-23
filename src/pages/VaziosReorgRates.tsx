import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input, Select } from '../components/ui/Input'
import { useAuth } from '../hooks/useAuth'
import { useDepots } from '../hooks/useDepots'
import {
  deleteDepot,
  deleteDepotService,
  listDepotServices,
  listDepotTariffs,
  upsertDepot,
  upsertDepotService,
  upsertDepotTariff,
  type DepotService,
  type DepotTariff,
} from '../services/depots'
import { formatBRL, formatDate } from '../lib/utils'

const dateToday = () => new Date().toISOString().slice(0, 10)

export function DepotCadastro() {
  const { can, isAdmin } = useAuth()
  const canEdit = can ? can('depots_edit') : isAdmin
  const queryClient = useQueryClient()
  const depots = useDepots()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = depots.data?.find((depot) => depot.id === selectedId) ?? depots.data?.[0] ?? null
  const [depotForm, setDepotForm] = useState({ code: '', name: '', pol_port: '', active: true })
  const [tariffForm, setTariffForm] = useState({ handling_in_brl: 0, handling_out_brl: 0, transporte_brl: 0, storage_day_brl: 0, free_time_days: 0, valid_from: dateToday(), valid_to: '', active: true })
  const [serviceForm, setServiceForm] = useState({ name: '', charge_basis: 'per_operation_qty' as DepotService['charge_basis'], rate_brl: 0, valid_from: dateToday(), valid_to: '', active: true })
  const tariffs = useQuery({ queryKey: ['depot-tariffs', selected?.id], queryFn: () => listDepotTariffs(selected!.id), enabled: Boolean(selected) })
  const services = useQuery({ queryKey: ['depot-services', selected?.id], queryFn: () => listDepotServices(selected!.id), enabled: Boolean(selected) })

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['depots'] })
    await queryClient.invalidateQueries({ queryKey: ['depot-tariffs'] })
    await queryClient.invalidateQueries({ queryKey: ['depot-services'] })
  }

  async function saveDepot() {
    await upsertDepot({ ...depotForm, id: selected?.id })
    await refresh()
  }

  async function saveTariff() {
    if (!selected) return
    await upsertDepotTariff({ ...tariffForm, depot_id: selected.id, valid_to: tariffForm.valid_to || null })
    await tariffs.refetch()
  }

  async function saveService() {
    if (!selected) return
    await upsertDepotService({ ...serviceForm, depot_id: selected.id, valid_to: serviceForm.valid_to || null })
    setServiceForm((form) => ({ ...form, name: '', rate_brl: 0 }))
    await services.refetch()
  }

  return (
    <div className="grid gap-5">
      <PageHeader title="Cadastro de Depot" description="Depots, tarifas vigentes e serviços extras usados pelo fluxo VAZIOS EXP." action={canEdit ? <Button onClick={() => { setSelectedId(null); setDepotForm({ code: '', name: '', pol_port: '', active: true }) }}><Plus size={16} /> Novo depot</Button> : null} />
      {depots.error ? <InlineError message="Erro ao carregar depots." /> : null}
      <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
        <Card className="grid content-start gap-2">
          <h2 className="app-panel__title">Depots</h2>
          {(depots.data ?? []).map((depot) => <button key={depot.id} type="button" onClick={() => { setSelectedId(depot.id); setDepotForm({ code: depot.code, name: depot.name ?? '', pol_port: depot.pol_port ?? '', active: depot.active }) }} className={`rounded-lg border px-3 py-2 text-left text-sm ${selected?.id === depot.id ? 'border-[var(--app-blue-btn)]' : 'border-[var(--app-border)]'}`}><span className="font-semibold">{depot.code}</span><span className="block text-xs text-[var(--app-muted)]">{depot.name || depot.pol_port || 'Sem nome'}</span></button>)}
          {!depots.data?.length ? <p className="text-sm text-[var(--app-muted)]">Nenhum depot cadastrado.</p> : null}
        </Card>
        <div className="grid gap-5">
          <Card className="grid gap-3">
            <h2 className="app-panel__title">Identificação</h2>
            <div className="grid gap-3 md:grid-cols-3"><Field label="Código"><Input value={depotForm.code} disabled={!canEdit} onChange={(event) => setDepotForm((f) => ({ ...f, code: event.target.value }))} /></Field><Field label="Nome"><Input value={depotForm.name} disabled={!canEdit} onChange={(event) => setDepotForm((f) => ({ ...f, name: event.target.value }))} /></Field><Field label="POL / porto"><Input value={depotForm.pol_port} disabled={!canEdit} onChange={(event) => setDepotForm((f) => ({ ...f, pol_port: event.target.value }))} /></Field></div>
            {canEdit ? <div className="flex gap-2"><Button onClick={() => void saveDepot()} disabled={!depotForm.code.trim()}>Salvar depot</Button>{selected ? <Button variant="danger" onClick={() => void deleteDepot(selected.id).then(refresh)}><Trash2 size={15} /> Excluir</Button> : null}</div> : null}
          </Card>
          {selected ? <>
            <Card className="grid gap-3"><h2 className="app-panel__title">Tarifas vigentes</h2><div className="grid gap-3 md:grid-cols-4"><Field label="Handling in"><Input type="number" min={0} step="0.01" disabled={!canEdit} value={tariffForm.handling_in_brl} onChange={(e) => setTariffForm((f) => ({ ...f, handling_in_brl: Number(e.target.value) }))} /></Field><Field label="Handling out"><Input type="number" min={0} step="0.01" disabled={!canEdit} value={tariffForm.handling_out_brl} onChange={(e) => setTariffForm((f) => ({ ...f, handling_out_brl: Number(e.target.value) }))} /></Field><Field label="Transporte"><Input type="number" min={0} step="0.01" disabled={!canEdit} value={tariffForm.transporte_brl} onChange={(e) => setTariffForm((f) => ({ ...f, transporte_brl: Number(e.target.value) }))} /></Field><Field label="Storage / dia"><Input type="number" min={0} step="0.01" disabled={!canEdit} value={tariffForm.storage_day_brl} onChange={(e) => setTariffForm((f) => ({ ...f, storage_day_brl: Number(e.target.value) }))} /></Field><Field label="Free time (dias)"><Input type="number" min={0} disabled={!canEdit} value={tariffForm.free_time_days} onChange={(e) => setTariffForm((f) => ({ ...f, free_time_days: Number(e.target.value) }))} /></Field><Field label="Vigência inicial"><Input type="date" disabled={!canEdit} value={tariffForm.valid_from} onChange={(e) => setTariffForm((f) => ({ ...f, valid_from: e.target.value }))} /></Field><Field label="Vigência final"><Input type="date" disabled={!canEdit} value={tariffForm.valid_to} onChange={(e) => setTariffForm((f) => ({ ...f, valid_to: e.target.value }))} /></Field></div>{canEdit ? <Button onClick={() => void saveTariff()}>Adicionar tarifa</Button> : null}<ul className="grid gap-2 text-sm">{(tariffs.data ?? []).map((tariff: DepotTariff) => <li key={tariff.id} className="rounded-lg border border-[var(--app-border)] px-3 py-2">{formatBRL(Number(tariff.handling_in_brl) + Number(tariff.handling_out_brl))} handling + {formatBRL(Number(tariff.transporte_brl))} transporte · {tariff.free_time_days} dias · {formatDate(tariff.valid_from)}{tariff.valid_to ? ` — ${formatDate(tariff.valid_to)}` : ' — vigente'}</li>)}</ul></Card>
            <Card className="grid gap-3"><h2 className="app-panel__title">Serviços extras</h2><div className="grid gap-3 md:grid-cols-4"><Field label="Nome"><Input disabled={!canEdit} value={serviceForm.name} onChange={(e) => setServiceForm((f) => ({ ...f, name: e.target.value }))} placeholder="visual_check" /></Field><Field label="Base"><Select disabled={!canEdit} value={serviceForm.charge_basis} onChange={(e) => setServiceForm((f) => ({ ...f, charge_basis: e.target.value as DepotService['charge_basis'] }))}><option value="per_container_flag">Por flag do container</option><option value="per_operation_qty">Por quantidade da operação</option></Select></Field><Field label="Tarifa"><Input type="number" min={0} step="0.01" disabled={!canEdit} value={serviceForm.rate_brl} onChange={(e) => setServiceForm((f) => ({ ...f, rate_brl: Number(e.target.value) }))} /></Field></div>{canEdit ? <Button onClick={() => void saveService()} disabled={!serviceForm.name.trim()}>Adicionar serviço</Button> : null}<ul className="grid gap-2 text-sm">{(services.data ?? []).map((service: DepotService) => <li key={service.id} className="rounded-lg border border-[var(--app-border)] px-3 py-2">{service.name} · {formatBRL(Number(service.rate_brl))} · {service.charge_basis === 'per_container_flag' ? 'por container' : 'por operação'} · {formatDate(service.valid_from)}{canEdit ? <Button variant="ghost" onClick={() => void deleteDepotService(service.id).then(() => services.refetch())}>Excluir</Button> : null}</li>)}</ul></Card>
          </> : <Card><p className="text-sm text-[var(--app-muted)]">Selecione ou crie um depot para configurar tarifas.</p></Card>}
        </div>
      </div>
    </div>
  )
}

export const VaziosReorgRates = DepotCadastro
