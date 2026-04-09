import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Save } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { Field, Input, Select, Textarea } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { useAuditLogs, useBlDetail } from '../hooks/useBls'
import { formatBRL, formatDate } from '../lib/utils'
import { supabase } from '../services/supabase'
import type { BL, BLDetail } from '../types/database'

const editableFields: (keyof Pick<
  BL,
  | 'shipper'
  | 'consignee'
  | 'notify_party'
  | 'pol'
  | 'pod'
  | 'place_of_delivery'
  | 'cargo_description'
  | 'total_weight_kg'
  | 'total_cbm'
  | 'incoterm'
  | 'payment_type'
  | 'free_time_override'
  | 'notes'
  | 'review_status'
>)[] = [
  'shipper',
  'consignee',
  'notify_party',
  'pol',
  'pod',
  'place_of_delivery',
  'cargo_description',
  'total_weight_kg',
  'total_cbm',
  'incoterm',
  'payment_type',
  'free_time_override',
  'notes',
  'review_status',
]

type BlForm = Pick<BL, (typeof editableFields)[number]>

export function BlDetalhe() {
  const { blId } = useParams()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()
  const { data: bl, isLoading, error } = useBlDetail(blId)
  const { data: auditLogs } = useAuditLogs('bl', blId)
  const [form, setForm] = useState<BlForm | null>(null)
  const [justification, setJustification] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!bl) return
    setForm(makeForm(bl))
  }, [bl])

  const changes = useMemo(() => {
    if (!bl || !form) return []

    return editableFields.filter((field) => stringifyValue(bl[field]) !== stringifyValue(form[field]))
  }, [bl, form])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    if (!bl || !form || !user) return

    if (changes.length === 0) {
      showToast('Nenhuma alteração detectada.', 'info')
      return
    }

    if (!justification.trim()) {
      showToast('Informe a justificativa para registrar a auditoria.', 'error')
      return
    }

    setSaving(true)
    try {
      const updatePayload = Object.fromEntries(
        changes.map((field) => [field, normalizeFormValue(field, form[field])]),
      ) as Partial<BL>
      const { error: updateError } = await supabase.from('bls').update(updatePayload).eq('id', bl.id)
      if (updateError) throw updateError

      const { error: auditError } = await supabase.from('audit_logs').insert(
        changes.map((field) => ({
          entity_type: 'bl',
          entity_id: bl.id,
          field_name: field,
          old_value: stringifyValue(bl[field]),
          new_value: stringifyValue(form[field]),
          changed_by: user.id,
          justification,
        })),
      )
      if (auditError) throw auditError

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bl-detail', bl.id] }),
        queryClient.invalidateQueries({ queryKey: ['audit-logs', 'bl', bl.id] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
      ])
      setJustification('')
      showToast('B/L salvo com auditoria campo a campo.', 'success')
    } catch {
      showToast('Falha ao salvar alterações do B/L.', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return <Card>Carregando detalhe do B/L...</Card>
  }

  if (error || !bl || !form) {
    return <Card className="text-red-200">B/L não encontrado ou erro ao consultar o Supabase.</Card>
  }

  return (
    <>
      <PageHeader
        title={`B/L ${bl.id}`}
        description="Edição manual com justificativa obrigatória e auditoria campo a campo."
        action={
          <Link className="text-sm font-semibold text-[#58a6ff] hover:underline" to="/manifestos">
            <ArrowLeft className="mr-1 inline" size={16} />
            Voltar aos manifestos
          </Link>
        }
      />

      <form className="grid gap-5" onSubmit={handleSubmit}>
        <Card>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <StatusBadge label="Revisão" value={bl.review_status ?? 'ok'} />
            <StatusBadge label="Financeiro" value={bl.financial_status ?? 'pending'} />
            {changes.length ? <Badge tone="yellow">{changes.length} alteração(ões) pendentes</Badge> : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Field label="Armador / Navio / Viagem">
              <Input
                disabled
                value={`${bl.voyage?.vessel?.carrier?.name ?? '-'} / ${bl.voyage?.vessel?.name ?? '-'} / ${
                  bl.voyage?.voyage_number ?? '-'
                }`}
              />
            </Field>
            <Field label="POL">
              <Input value={form.pol ?? ''} onChange={(event) => setField('pol', event.target.value)} />
            </Field>
            <Field label="POD">
              <Input value={form.pod ?? ''} onChange={(event) => setField('pod', event.target.value)} />
            </Field>
            <Field label="Place of Delivery">
              <Input
                value={form.place_of_delivery ?? ''}
                onChange={(event) => setField('place_of_delivery', event.target.value)}
              />
            </Field>
            <Field label="Shipper">
              <Input value={form.shipper ?? ''} onChange={(event) => setField('shipper', event.target.value)} />
            </Field>
            <Field label="Consignatário">
              <Input value={form.consignee ?? ''} onChange={(event) => setField('consignee', event.target.value)} />
            </Field>
            <Field label="Notify Party">
              <Input
                value={form.notify_party ?? ''}
                onChange={(event) => setField('notify_party', event.target.value)}
              />
            </Field>
            <Field label="Peso total (kg)">
              <Input
                type="number"
                value={form.total_weight_kg ?? ''}
                onChange={(event) => setField('total_weight_kg', event.target.value)}
              />
            </Field>
            <Field label="CBM total">
              <Input
                type="number"
                value={form.total_cbm ?? ''}
                onChange={(event) => setField('total_cbm', event.target.value)}
              />
            </Field>
            <Field label="Incoterm">
              <Input value={form.incoterm ?? ''} onChange={(event) => setField('incoterm', event.target.value)} />
            </Field>
            <Field label="Pagamento">
              <Select
                value={form.payment_type ?? ''}
                onChange={(event) => setField('payment_type', event.target.value as BL['payment_type'])}
              >
                <option value="">Não informado</option>
                <option value="PREPAID">PREPAID</option>
                <option value="COLLECT">COLLECT</option>
              </Select>
            </Field>
            <Field label="Free time override">
              <Input
                type="number"
                value={form.free_time_override ?? ''}
                onChange={(event) => setField('free_time_override', event.target.value)}
              />
            </Field>
            <Field label="Status de revisão">
              <Select
                value={form.review_status ?? 'ok'}
                onChange={(event) => setField('review_status', event.target.value as BL['review_status'])}
              >
                <option value="ok">OK</option>
                <option value="pending_review">Pendente</option>
                <option value="reviewed">Revisado</option>
              </Select>
            </Field>
          </div>

          <div className="mt-4 grid gap-4">
            <Field label="Descrição da carga">
              <Textarea
                value={form.cargo_description ?? ''}
                onChange={(event) => setField('cargo_description', event.target.value)}
              />
            </Field>
            <Field label="Notas">
              <Textarea value={form.notes ?? ''} onChange={(event) => setField('notes', event.target.value)} />
            </Field>
            <Field label="Justificativa da alteração manual">
              <Textarea value={justification} onChange={(event) => setJustification(event.target.value)} required />
            </Field>
          </div>

          <div className="mt-5 flex justify-end">
            <Button loading={saving} type="submit">
              <Save size={16} />
              Salvar alterações
            </Button>
          </div>
        </Card>
      </form>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-white">Containers</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2">Nº Container</th>
                  <th className="py-2">Seal</th>
                  <th className="py-2">Tipo</th>
                  <th className="py-2">Peso bruto</th>
                  <th className="py-2">CBM</th>
                  <th className="py-2">OOG</th>
                  <th className="py-2">IMO</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]">
                {bl.bl_containers?.map((container) => (
                  <tr key={container.id}>
                    <td className="py-2 font-semibold text-white">{container.container_number}</td>
                    <td className="py-2">{container.seal_number ?? '-'}</td>
                    <td className="py-2">{container.type ?? '-'}</td>
                    <td className="py-2">{Number(container.gross_weight_kg ?? 0).toLocaleString('pt-BR')} kg</td>
                    <td className="py-2">{Number(container.cbm ?? 0).toLocaleString('pt-BR')}</td>
                    <td className="py-2">{container.is_oog ? <Badge tone="yellow">Sim</Badge> : '-'}</td>
                    <td className="py-2">{container.is_imo ? <Badge tone="red">Sim</Badge> : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-lg font-semibold text-white">Financeiro e cliente</h2>
          <dl className="grid gap-3 text-sm">
            <InfoLine label="Cliente" value={bl.customer?.name ?? 'Não vinculado'} />
            <InfoLine label="CNPJ/CPF" value={bl.customer?.cnpj_cpf ?? '-'} />
            <InfoLine label="Saldo pendente" value={formatBRL(bl.customer?.pending_balance ?? 0)} />
            <InfoLine label="Trecho" value={`${bl.pol ?? '-'} -> ${bl.pod ?? '-'}`} />
          </dl>
        </Card>

        <Card className="xl:col-span-2">
          <h2 className="mb-4 text-lg font-semibold text-white">Auditoria</h2>
          <div className="grid gap-3">
            {auditLogs?.length ? null : <div className="text-sm text-slate-400">Nenhuma alteração auditada ainda.</div>}
            {auditLogs?.map((log) => (
              <div key={log.id} className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-sm">
                <div className="font-semibold text-white">
                  {log.field_name}: {log.old_value || '-'} → {log.new_value || '-'}
                </div>
                <div className="mt-1 text-slate-400">
                  {formatDate(log.changed_at)} · {log.justification ?? 'Sem justificativa'}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  )

  function setField<K extends keyof BlForm>(field: K, value: BlForm[K] | string) {
    setForm((current) => (current ? { ...current, [field]: value } : current))
  }
}

function makeForm(bl: BLDetail): BlForm {
  return {
    shipper: bl.shipper,
    consignee: bl.consignee,
    notify_party: bl.notify_party,
    pol: bl.pol,
    pod: bl.pod,
    place_of_delivery: bl.place_of_delivery,
    cargo_description: bl.cargo_description,
    total_weight_kg: bl.total_weight_kg,
    total_cbm: bl.total_cbm,
    incoterm: bl.incoterm,
    payment_type: bl.payment_type,
    free_time_override: bl.free_time_override,
    notes: bl.notes,
    review_status: bl.review_status,
  }
}

function stringifyValue(value: unknown) {
  return value === null || value === undefined ? '' : String(value)
}

function normalizeFormValue(field: keyof BlForm, value: unknown) {
  if (['total_weight_kg', 'total_cbm', 'free_time_override'].includes(field)) {
    return value === '' || value === null || value === undefined ? null : Number(value)
  }

  return value === '' ? null : value
}

function StatusBadge({ label, value }: { label: string; value: string }) {
  return (
    <Badge tone={value.includes('pending') ? 'yellow' : value.includes('paid') || value.includes('reviewed') ? 'green' : 'blue'}>
      {label}: {value}
    </Badge>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[#30363d] pb-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-semibold text-slate-100">{value}</dd>
    </div>
  )
}
