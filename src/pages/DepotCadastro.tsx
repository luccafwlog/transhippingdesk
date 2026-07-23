import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Edit3, Plus, Power, Trash2 } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input, Select } from '../components/ui/Input'
import { useAuth } from '../hooks/useAuth'
import { useDepots } from '../hooks/useDepots'
import { deleteDepot, deleteDepotService, listDepotServices, upsertDepot, upsertDepotService, type DepotService } from '../services/depots'
import { formatBRL, formatDate } from '../lib/utils'

const today = () => new Date().toISOString().slice(0, 10)
const isVigente = (service: Pick<DepotService, 'active' | 'valid_from' | 'valid_to'>) => service.active && service.valid_from <= today() && (!service.valid_to || service.valid_to >= today())
const calcTypes = [
  ['fixo_por_container', 'Fixo por container'],
  ['storage_por_dias', 'Storage por dias'],
  ['quantidade', 'Quantidade (lançada no Vazios EXP)'],
] as const

export function DepotCadastro() {
  const { can } = useAuth()
  const canEdit = can('depots_edit')
  const depots = useDepots()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newDepot, setNewDepot] = useState(false)
  const selected = newDepot ? null : depots.data?.find((item) => item.id === selectedId) ?? depots.data?.[0] ?? null
  const [depotForm, setDepotForm] = useState({ code: '', name: '', pol_port: '', free_time_days: 0, active: true })
  const [serviceForm, setServiceForm] = useState({ name: '', calc_type: 'fixo_por_container', rate_brl: 0, subject_to_overtime: false, valid_from: today(), valid_to: '', active: true })
  const services = useQuery({ queryKey: ['depot-services', selected?.id], queryFn: () => listDepotServices(selected!.id), enabled: Boolean(selected) })

  function choose(id: string) {
    const depot = depots.data?.find((item) => item.id === id)
    if (!depot) return
    setNewDepot(false); setSelectedId(id)
    setDepotForm({ code: depot.code, name: depot.name ?? '', pol_port: depot.pol_port ?? '', free_time_days: depot.free_time_days, active: depot.active })
  }
  async function saveDepot() {
    await upsertDepot({ ...depotForm, id: selected?.id })
    await depots.refetch(); setNewDepot(false)
  }
  async function saveService() {
    if (!selected) return
    await upsertDepotService({ ...serviceForm, depot_id: selected.id, calc_type: serviceForm.calc_type, valid_to: serviceForm.valid_to || null })
    setServiceForm({ name: '', calc_type: 'fixo_por_container', rate_brl: 0, subject_to_overtime: false, valid_from: today(), valid_to: '', active: true }); await services.refetch()
  }
  function editService(service: DepotService) {
    setServiceForm({ name: service.name, calc_type: service.calc_type, rate_brl: Number(service.rate_brl), subject_to_overtime: service.subject_to_overtime, valid_from: service.valid_from, valid_to: service.valid_to ?? '', active: service.active })
  }
  return <div className="grid gap-5">
    <PageHeader title="Tabela de Depots" description="Depots e serviços precificados por tipo de cálculo usados pelo fluxo VAZIOS EXP." action={canEdit ? <Button onClick={() => { setNewDepot(true); setSelectedId(null); setDepotForm({ code: '', name: '', pol_port: '', free_time_days: 0, active: true }) }}><Plus size={16} /> Novo depot</Button> : null} />
    {depots.error ? <InlineError message="Erro ao carregar depots." /> : null}
    <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
      <Card className="grid content-start gap-2"><h2 className="app-panel__title">Depots</h2>{(depots.data ?? []).map((depot) => <button key={depot.id} type="button" onClick={() => choose(depot.id)} className={`rounded-lg border px-3 py-2 text-left text-sm ${selected?.id === depot.id ? 'border-[var(--app-blue-btn)]' : 'border-[var(--app-border)]'}`}><span className="font-semibold">{depot.code}</span><span className="block text-xs text-[var(--app-muted)]">{depot.name || depot.pol_port || 'Sem nome'}</span></button>)}</Card>
      <div className="grid gap-5"><Card className="grid gap-3"><h2 className="app-panel__title">Identificação</h2><div className="grid gap-3 md:grid-cols-4"><Field label="Código"><Input value={depotForm.code} disabled={!canEdit} onChange={(e) => setDepotForm((f) => ({ ...f, code: e.target.value }))} /></Field><Field label="Nome"><Input value={depotForm.name} disabled={!canEdit} onChange={(e) => setDepotForm((f) => ({ ...f, name: e.target.value }))} /></Field><Field label="POL / porto"><Input value={depotForm.pol_port} disabled={!canEdit} onChange={(e) => setDepotForm((f) => ({ ...f, pol_port: e.target.value }))} /></Field><Field label="Free time (dias)"><Input type="number" min={0} value={depotForm.free_time_days} disabled={!canEdit} onChange={(e) => setDepotForm((f) => ({ ...f, free_time_days: Number(e.target.value) }))} /></Field></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={depotForm.active} disabled={!canEdit} onChange={(e) => setDepotForm((f) => ({ ...f, active: e.target.checked }))} /> Depot ativo</label>{canEdit ? <span className="flex gap-2"><Button onClick={() => void saveDepot()} disabled={!depotForm.code.trim()}>Salvar depot</Button>{selected ? <Button variant="ghost" onClick={() => void deleteDepot(selected.id).then(() => depots.refetch())}>Excluir depot</Button> : null}</span> : null}</Card>
        {selected ? <Card className="grid gap-3"><h2 className="app-panel__title">Serviços</h2><div className="grid gap-3 md:grid-cols-5"><Field label="Nome"><Input value={serviceForm.name} disabled={!canEdit} onChange={(e) => setServiceForm((f) => ({ ...f, name: e.target.value }))} /></Field><Field label="Tipo de cálculo"><Select value={serviceForm.calc_type} disabled={!canEdit} onChange={(e) => setServiceForm((f) => ({ ...f, calc_type: e.target.value }))}>{calcTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field><Field label="Valor unitário"><Input type="number" min={0} step="0.01" value={serviceForm.rate_brl} disabled={!canEdit} onChange={(e) => setServiceForm((f) => ({ ...f, rate_brl: Number(e.target.value) }))} /></Field><Field label="Vigência inicial"><Input type="date" value={serviceForm.valid_from} disabled={!canEdit} onChange={(e) => setServiceForm((f) => ({ ...f, valid_from: e.target.value }))} /></Field><Field label="Vigência final"><Input type="date" value={serviceForm.valid_to} disabled={!canEdit} onChange={(e) => setServiceForm((f) => ({ ...f, valid_to: e.target.value }))} /></Field><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={serviceForm.subject_to_overtime} disabled={!canEdit} onChange={(e) => setServiceForm((f) => ({ ...f, subject_to_overtime: e.target.checked }))} /> Sujeito a overtime</label></div>{canEdit ? <Button onClick={() => void saveService()} disabled={!serviceForm.name.trim()}><Plus size={16} /> Salvar serviço</Button> : null}<ul className="grid gap-2 text-sm">{(services.data ?? []).map((service: DepotService) => <li key={service.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--app-border)] px-3 py-2"><span className={service.active ? '' : 'opacity-60'}>{service.name} · {formatBRL(Number(service.rate_brl))} · {calcTypes.find(([value]) => value === service.calc_type)?.[1] ?? service.calc_type} · {formatDate(service.valid_from)}{service.valid_to ? ` — ${formatDate(service.valid_to)}` : ''} · {isVigente(service) ? 'vigente' : service.active ? 'fora da vigência' : 'inativo'}</span>{canEdit ? <span className="flex gap-1"><Button variant="ghost" onClick={() => editService(service)}><Edit3 size={14} /> Editar</Button><Button variant="ghost" onClick={() => void upsertDepotService({ ...service, active: !service.active }).then(() => services.refetch())}><Power size={14} /> {service.active ? 'Inativar' : 'Ativar'}</Button><Button variant="ghost" onClick={() => void deleteDepotService(service.id).then(() => services.refetch())}><Trash2 size={14} /> Excluir</Button></span> : null}</li>)}</ul></Card> : <Card><p className="text-sm text-[var(--app-muted)]">Selecione ou crie um depot para configurar serviços.</p></Card>}
      </div>
    </div>
  </div>
}
