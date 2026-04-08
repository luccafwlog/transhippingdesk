import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { Field, Input, Select } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { useVoyages } from '../hooks/useBls'
import { formatDate } from '../lib/utils'
import { supabase } from '../services/supabase'

type VoyageForm = {
  carrierName: string
  carrierScac: string
  vesselName: string
  vesselImo: string
  voyageNumber: string
  polName: string
  polLocode: string
  podName: string
  podLocode: string
  etd: string
  eta: string
  status: 'active' | 'completed' | 'cancelled'
}

const initialForm: VoyageForm = {
  carrierName: '',
  carrierScac: '',
  vesselName: '',
  vesselImo: '',
  voyageNumber: '',
  polName: '',
  polLocode: '',
  podName: '',
  podLocode: '',
  etd: '',
  eta: '',
  status: 'active',
}

export function Viagens() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { isAdmin } = useAuth()
  const { showToast } = useToast()
  const { data, isLoading, error } = useVoyages()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<VoyageForm>(initialForm)
  const [saving, setSaving] = useState(false)

  const summary = useMemo(
    () => ({
      active: data?.filter((voyage) => voyage.status === 'active').length ?? 0,
      totalBls: data?.reduce((sum, voyage) => sum + (voyage.bls?.length ?? 0), 0) ?? 0,
      totalContainers:
        data?.reduce(
          (sum, voyage) =>
            sum +
            (voyage.bls?.reduce((blSum, bl) => blSum + (bl.bl_containers?.length ?? 0), 0) ?? 0),
          0,
        ) ?? 0,
    }),
    [data],
  )

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!isAdmin) return

    setSaving(true)
    try {
      const carrierId = await getOrCreateCarrier(form.carrierName, form.carrierScac)
      const vesselId = await getOrCreateVessel(form.vesselName, form.vesselImo, carrierId)
      const polId = await getOrCreatePort(form.polName, form.polLocode)
      const podId = await getOrCreatePort(form.podName, form.podLocode)

      const { data: created, error: createError } = await supabase
        .from('voyages')
        .insert({
          vessel_id: vesselId,
          voyage_number: form.voyageNumber.trim(),
          pol_id: polId,
          pod_id: podId,
          etd: form.etd || null,
          eta: form.eta || null,
          status: form.status,
        })
        .select('id')
        .single()

      if (createError) throw createError

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
        queryClient.invalidateQueries({ queryKey: ['voyage-options'] }),
      ])

      showToast('Viagem cadastrada com sucesso.', 'success')
      setOpen(false)
      setForm(initialForm)

      if (created?.id) {
        navigate(`/manifestos?voyage=${created.id}`)
      }
    } catch {
      showToast('Falha ao cadastrar viagem. Revise os dados e tente novamente.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Viagens"
        description="Cards por navio/viagem com criação de nova viagem e redirecionamento para os manifestos."
        action={
          isAdmin ? (
            <Button onClick={() => setOpen(true)}>
              <Plus size={16} />
              Nova Viagem
            </Button>
          ) : null
        }
      />

      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <MetricCard label="Viagens ativas" value={summary.active} />
        <MetricCard label="B/Ls vinculados" value={summary.totalBls} />
        <MetricCard label="Containers vinculados" value={summary.totalContainers} />
      </div>

      {error ? <Card className="mb-5 text-red-200">Erro ao carregar viagens.</Card> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {isLoading ? <Card>Carregando viagens...</Card> : null}
        {data?.map((voyage) => {
          const totalBls = voyage.bls?.length ?? 0
          const totalContainers = voyage.bls?.reduce((sum, bl) => sum + (bl.bl_containers?.length ?? 0), 0) ?? 0

          return (
            <Card key={voyage.id} className="grid gap-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-500">
                    {voyage.vessel?.carrier?.name ?? 'Armador não informado'}
                  </div>
                  <h2 className="text-xl font-bold text-white">
                    {voyage.vessel?.name ?? 'Navio'} / {voyage.voyage_number}
                  </h2>
                </div>
                <span className="rounded-full border border-[#1f6feb]/30 bg-[#1f6feb]/10 px-3 py-1 text-xs font-semibold text-[#8cc8ff]">
                  {voyage.status ?? 'active'}
                </span>
              </div>

              <dl className="grid gap-2 text-sm text-slate-300">
                <Info label="POL" value={voyage.pol?.name ?? '-'} />
                <Info label="POD" value={voyage.pod?.name ?? '-'} />
                <Info label="ETD" value={formatDate(voyage.etd)} />
                <Info label="ETA" value={formatDate(voyage.eta)} />
                <Info label="ATA" value={formatDate(voyage.ata)} />
                <Info label="B/Ls" value={String(totalBls)} />
                <Info label="Containers" value={String(totalContainers)} />
              </dl>

              <div>
                <Button variant="secondary" onClick={() => navigate(`/manifestos?voyage=${voyage.id}`)}>
                  Ver manifestos desta viagem
                </Button>
              </div>
            </Card>
          )
        })}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Nova Viagem">
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
              <Select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as VoyageForm['status'] }))}>
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
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button loading={saving} type="submit">
              Cadastrar viagem
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-bold text-white">{value}</div>
    </Card>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[#30363d] pb-2">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-semibold text-white">{value}</span>
    </div>
  )
}

async function getOrCreateCarrier(name: string, scac: string) {
  let query = supabase.from('carriers').select('id').limit(1)
  if (scac.trim()) {
    query = query.eq('scac', scac.trim())
  } else {
    query = query.eq('name', name.trim())
  }

  const { data: existing, error: existingError } = await query
  if (existingError) throw existingError
  if (existing?.[0]) return existing[0].id

  const { data: created, error: createError } = await supabase
    .from('carriers')
    .insert({ name: name.trim(), scac: scac.trim() || null })
    .select('id')
    .single()

  if (createError || !created) throw createError
  return created.id
}

async function getOrCreateVessel(name: string, imo: string, carrierId: number) {
  const { data: existing, error: existingError } = await supabase
    .from('vessels')
    .select('id')
    .eq('name', name.trim())
    .limit(1)

  if (existingError) throw existingError
  if (existing?.[0]) return existing[0].id

  const { data: created, error: createError } = await supabase
    .from('vessels')
    .insert({ name: name.trim(), imo: imo.trim() || null, carrier_id: carrierId })
    .select('id')
    .single()

  if (createError || !created) throw createError
  return created.id
}

async function getOrCreatePort(name: string, locode: string) {
  let query = supabase.from('ports').select('id').limit(1)
  if (locode.trim()) {
    query = query.eq('locode', locode.trim())
  } else {
    query = query.eq('name', name.trim())
  }

  const { data: existing, error: existingError } = await query
  if (existingError) throw existingError
  if (existing?.[0]) return existing[0].id

  const { data: created, error: createError } = await supabase
    .from('ports')
    .insert({ name: name.trim(), locode: locode.trim() || null })
    .select('id')
    .single()

  if (createError || !created) throw createError
  return created.id
}
