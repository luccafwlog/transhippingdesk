import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Calculator, Pencil, RotateCcw, Save, Trash2, X } from 'lucide-react'
import { countDistinctContainerNumbers, countDistinctContainerNumbersBy } from '../lib/containerCounts'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { Field, Input, Select, Textarea } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { useAuditLogs, useBlDetail } from '../hooks/useBls'
import { useInvoiceLinks } from '../hooks/useBilling'
import {
  useAddManualBlCharge,
  useBlLocalChargeLines,
  useCalculateBlLocalCharges,
  useDeleteManualBlCharge,
  useManualChargeItemsForBl,
  useMarkBlChargesReviewed,
  useMarkBlReadyForBilling,
  useUpdateManualBlCharge,
} from '../hooks/useLocalCharges'
import { formatBRL, formatDate, normalizeText } from '../lib/utils'
import { logOperationalEvent } from '../services/operationalEvents'
import { supabase } from '../services/supabase'
import type { BL, BLDetail } from '../types/database'

const editableFields: (keyof Pick<
  BL,
  | 'shipper'
  | 'consignee'
  | 'notify_party'
  | 'ce_mercante'
  | 'bb_machine_qty'
  | 'bb_packages_qty'
  | 'bb_packages_total'
  | 'bb_weight_ton'
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
  'ce_mercante',
  'bb_machine_qty',
  'bb_packages_qty',
  'bb_packages_total',
  'bb_weight_ton',
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
type CargoMode = 'container' | 'carga_solta'
const INVALID_NUMERIC_VALUE = Symbol('INVALID_NUMERIC_VALUE')
type ManualChargeForm = {
  chargeItemId: string
  quantity: string
  notes: string
  editingChargeCalculationId: number | null
}

const EMPTY_MANUAL_CHARGE_FORM: ManualChargeForm = {
  chargeItemId: '',
  quantity: '1',
  notes: '',
  editingChargeCalculationId: null,
}

export function BlDetalhe() {
  const { blId } = useParams()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()
  const { data: bl, isLoading, error } = useBlDetail(blId)
  const { data: invoiceLinksByBl } = useInvoiceLinks(bl?.id ? [bl.id] : [])
  const { data: auditLogs } = useAuditLogs('bl', blId)
  const { data: localChargeLines, isLoading: isLocalChargeLinesLoading } = useBlLocalChargeLines(bl?.id)
  const { data: manualChargeItems, isLoading: isManualChargeItemsLoading } = useManualChargeItemsForBl(bl?.id)
  const calculateLocalChargesMutation = useCalculateBlLocalCharges(bl?.id)
  const addManualChargeMutation = useAddManualBlCharge(bl?.id)
  const updateManualChargeMutation = useUpdateManualBlCharge(bl?.id)
  const deleteManualChargeMutation = useDeleteManualBlCharge(bl?.id)
  const markReviewedMutation = useMarkBlChargesReviewed(bl?.id)
  const markReadyForBillingMutation = useMarkBlReadyForBilling(bl?.id)
  const [form, setForm] = useState<BlForm | null>(null)
  const [justification, setJustification] = useState('')
  const [saving, setSaving] = useState(false)
  const [vehicleSearch, setVehicleSearch] = useState('')
  const [manualChargeForm, setManualChargeForm] = useState<ManualChargeForm>(EMPTY_MANUAL_CHARGE_FORM)

  useEffect(() => {
    if (!bl) return
    setForm(makeForm(bl))
  }, [bl])

  const cargoMode = useMemo(() => resolveCargoMode(bl), [bl])
  const isContainerMode = cargoMode === 'container'
  const backHref = isContainerMode ? '/manifestos' : '/carga-solta'
  const backLabel = isContainerMode ? 'Voltar aos manifestos CNTR' : 'Voltar aos manifestos BB'
  const latestInvoice = bl?.id ? invoiceLinksByBl?.[bl.id]?.[0] : null
  const baselineForm = useMemo(() => (bl ? makeForm(bl) : null), [bl])

  const changes = useMemo(() => {
    if (!baselineForm || !form) return []

    return editableFields.filter((field) => stringifyValue(baselineForm[field]) !== stringifyValue(form[field]))
  }, [baselineForm, form])

  const filteredVehicles = useMemo(() => {
    if (!isContainerMode) return []

    const term = normalizeText(vehicleSearch)
    if (!term) return bl?.vehicles ?? []
    return (bl?.vehicles ?? []).filter((vehicle) => normalizeText(vehicle.chassis).includes(term))
  }, [bl?.vehicles, isContainerMode, vehicleSearch])

  const containerSummary = useMemo(
    () => ({
      distinct: countDistinctContainerNumbers(bl?.bl_containers),
      imo: countDistinctContainerNumbersBy(bl?.bl_containers, (container) => Boolean(container.is_imo)),
      oog: countDistinctContainerNumbersBy(bl?.bl_containers, (container) => Boolean(container.is_oog)),
    }),
    [bl?.bl_containers],
  )

  const breakbulkSummary = useMemo(
    () => ({
      machines: Number(bl?.bb_machine_qty ?? 0),
      packages: Number(bl?.bb_packages_qty ?? 0),
      packagesTotal: Number(bl?.bb_packages_total ?? bl?.bb_packages_qty ?? 0),
      weightTon: Number(bl?.bb_weight_ton ?? (bl?.total_weight_kg ? Number(bl.total_weight_kg) / 1000 : 0)),
      cbm: Number(bl?.total_cbm ?? 0),
    }),
    [bl?.bb_machine_qty, bl?.bb_packages_qty, bl?.bb_packages_total, bl?.bb_weight_ton, bl?.total_cbm, bl?.total_weight_kg],
  )

  const localChargeSummary = useMemo(() => {
    const lines = localChargeLines ?? []
    const totalBrl = lines.reduce((sum, line) => sum + Number(line.total_value_brl ?? 0), 0)
    const totalUsd = lines.reduce((sum, line) => sum + Number(line.total_value_usd ?? 0), 0)
    const hasReviewRequired = lines.some((line) => line.status === 'review_required')
    return {
      lines,
      totalBrl,
      totalUsd,
      hasReviewRequired,
    }
  }, [localChargeLines])

  async function handleCalculateLocalCharges(recalculate: boolean) {
    if (!bl) return

    try {
      const result = await calculateLocalChargesMutation.mutateAsync({
        actorId: user?.id ?? null,
        recalculate,
      })

      if (result.status === 'exempt') {
        showToast('B/L marcado como isento de taxas locais por regra de veiculos/LCL.', 'success')
        return
      }

      if (result.status === 'review_required') {
        showToast('Taxas calculadas com pendencia de revisao manual.', 'info')
        return
      }

      showToast('Taxas locais calculadas com sucesso.', 'success')
    } catch {
      showToast('Falha ao calcular taxas locais para este B/L.', 'error')
    }
  }

  async function handleSaveManualCharge() {
    if (!bl || !user) return

    const chargeItemId = Number(manualChargeForm.chargeItemId)
    const quantity = Number(String(manualChargeForm.quantity).replace(',', '.'))

    if (!Number.isInteger(chargeItemId) || chargeItemId <= 0) {
      showToast('Selecione um item de Other Charge.', 'error')
      return
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      showToast('Quantidade invalida para a linha manual.', 'error')
      return
    }

    try {
      if (manualChargeForm.editingChargeCalculationId) {
        await updateManualChargeMutation.mutateAsync({
          chargeCalculationId: manualChargeForm.editingChargeCalculationId,
          quantity,
          notes: manualChargeForm.notes || null,
          actorId: user.id,
        })
        showToast('Linha manual atualizada.', 'success')
      } else {
        await addManualChargeMutation.mutateAsync({
          chargeItemId,
          quantity,
          notes: manualChargeForm.notes || null,
          actorId: user.id,
        })
        showToast('Other Charge adicionado com sucesso.', 'success')
      }

      setManualChargeForm(EMPTY_MANUAL_CHARGE_FORM)
    } catch {
      showToast('Falha ao salvar linha manual de taxa.', 'error')
    }
  }

  function handleEditManualCharge(lineId: number) {
    const line = localChargeSummary.lines.find((entry) => entry.id === lineId && entry.source === 'manual')
    if (!line) return

    setManualChargeForm({
      chargeItemId: String(line.charge_item_id ?? ''),
      quantity: String(Number(line.quantity ?? 1)),
      notes: line.notes ?? '',
      editingChargeCalculationId: line.id,
    })
  }

  function handleCancelManualChargeEdit() {
    setManualChargeForm(EMPTY_MANUAL_CHARGE_FORM)
  }

  async function handleDeleteManualCharge(lineId: number) {
    if (!user) return
    if (!window.confirm('Excluir esta linha manual?')) return

    try {
      await deleteManualChargeMutation.mutateAsync({
        chargeCalculationId: lineId,
        actorId: user.id,
      })
      showToast('Linha manual removida.', 'success')
      if (manualChargeForm.editingChargeCalculationId === lineId) {
        setManualChargeForm(EMPTY_MANUAL_CHARGE_FORM)
      }
    } catch {
      showToast('Falha ao excluir linha manual.', 'error')
    }
  }

  async function handleMarkChargesReviewed() {
    if (!user) return
    try {
      await markReviewedMutation.mutateAsync({ actorId: user.id })
      showToast('Taxas marcadas como revisadas.', 'success')
    } catch {
      showToast('Falha ao marcar taxas como revisadas.', 'error')
    }
  }

  async function handleMarkReadyForBilling() {
    if (!user) return
    try {
      await markReadyForBillingMutation.mutateAsync({ actorId: user.id })
      showToast('B/L marcado como pronto para faturar.', 'success')
    } catch (error) {
      if (String((error as { message?: string }).message ?? '').includes('pendencia de revisao')) {
        showToast('Ainda existem linhas com pendencia de revisao.', 'error')
        return
      }
      showToast('Falha ao marcar B/L como pronto para faturar.', 'error')
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    if (!bl || !form || !user) return

    if (changes.length === 0) {
      showToast('Nenhuma alteracao detectada.', 'info')
      return
    }

    if (!justification.trim()) {
      showToast('Informe a justificativa para registrar a auditoria.', 'error')
      return
    }

    setSaving(true)
    try {
      const updatePayload: Record<string, unknown> = {}

      for (const field of changes) {
        const normalized = normalizeFormValue(field, form[field])
        if (normalized === INVALID_NUMERIC_VALUE) {
          showToast(`Valor invalido para ${field}. Informe um numero valido antes de salvar.`, 'error')
          return
        }
        updatePayload[field] = normalized
      }

      if (!isContainerMode) {
        const weightTon = normalizeFormValue('bb_weight_ton', form.bb_weight_ton)
        if (weightTon === INVALID_NUMERIC_VALUE) {
          showToast('Valor invalido para bb_weight_ton. Informe um numero valido antes de salvar.', 'error')
          return
        }
        updatePayload.total_weight_kg = weightTon === null ? null : Number(weightTon) * 1000
      }

      const auditRows = changes.map((field) => ({
        entity_type: 'bl',
        entity_id: bl.id,
        field_name: field,
        old_value: stringifyValue(baselineForm?.[field]),
        new_value: stringifyValue(form[field]),
        justification,
      }))

      if (!isContainerMode && changes.includes('bb_weight_ton')) {
        auditRows.push({
          entity_type: 'bl',
          entity_id: bl.id,
          field_name: 'total_weight_kg',
          old_value: stringifyValue(baselineForm?.total_weight_kg),
          new_value: stringifyValue(updatePayload.total_weight_kg),
          justification,
        })
      }

      const { error: rpcError } = await supabase.rpc('save_bl_review', {
        p_bl_id: bl.id,
        p_expected_updated_at: bl.updated_at ?? null,
        p_update_payload: updatePayload,
        p_audit_rows: auditRows,
        p_changed_by: user.id,
      })

      if (rpcError) {
        if (rpcError.code === 'PT409' || rpcError.code === '40001') {
          void logOperationalEvent({
            code: 'bl_review_concurrent_conflict',
            message: rpcError.message ?? 'Conflito concorrente ao salvar B/L',
            changedBy: user?.id ?? null,
            entityId: bl.id,
            context: { source: 'bl_detail' },
          })
          await queryClient.invalidateQueries({ queryKey: ['bl-detail', bl.id] })
          showToast(
            'Este B/L foi alterado por outro usuario. Os dados foram recarregados; revise e salve novamente.',
            'error',
          )
          return
        }
        throw rpcError
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bl-detail', bl.id] }),
        queryClient.invalidateQueries({ queryKey: ['audit-logs', 'bl', bl.id] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
      ])

      setJustification('')
      showToast('B/L salvo com auditoria campo a campo.', 'success')
    } catch {
      showToast('Falha ao salvar alteracoes do B/L.', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return <Card>Carregando detalhe do B/L...</Card>
  }

  if (error || !bl || !form) {
    return <Card className="text-red-200">B/L nao encontrado ou erro ao consultar o Supabase.</Card>
  }

  return (
    <>
      <PageHeader
        title={`B/L ${bl.id} - ${cargoModeLabel(cargoMode)}`}
        description={
          isContainerMode
            ? 'Edicao manual com auditoria. Esta tela exibe containers e veiculos vinculados a este B/L.'
            : 'Edicao manual com auditoria. Esta tela exibe o resumo operacional do manifesto BB vinculado a este B/L.'
        }
        action={
          <Link className="text-sm font-semibold text-[#58a6ff] hover:underline" to={backHref}>
            <ArrowLeft className="mr-1 inline" size={16} />
            {backLabel}
          </Link>
        }
      />

      <form className="grid gap-5" onSubmit={handleSubmit}>
        <Card>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <StatusBadge label="Modo" value={cargoModeLabel(cargoMode)} tone={isContainerMode ? 'blue' : 'green'} />
            <StatusBadge label="Revisao" value={bl.review_status ?? 'ok'} />
            <StatusBadge label="Financeiro" value={bl.financial_status ?? 'pending'} />
            {latestInvoice ? (
              <Link className="text-sm font-semibold text-[#58a6ff] hover:underline" to={`/faturamento?invoice=${latestInvoice.id}`}>
                Invoice ativa: {latestInvoice.invoice_number ?? `INV-${latestInvoice.id}`}
              </Link>
            ) : null}
            {changes.length ? <Badge tone="yellow">{changes.length} alteracao(oes) pendentes</Badge> : null}
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
            <Field label="CE Mercante">
              <Input
                value={form.ce_mercante ?? ''}
                onChange={(event) => setField('ce_mercante', event.target.value)}
              />
            </Field>
            {!isContainerMode ? (
              <>
                <Field label="Maquinas">
                  <Input
                    type="number"
                    value={form.bb_machine_qty ?? ''}
                    onChange={(event) => setField('bb_machine_qty', event.target.value)}
                  />
                </Field>
                <Field label="Packages">
                  <Input
                    type="number"
                    value={form.bb_packages_qty ?? ''}
                    onChange={(event) => setField('bb_packages_qty', event.target.value)}
                  />
                </Field>
                <Field label="Packages Total">
                  <Input
                    type="number"
                    value={form.bb_packages_total ?? ''}
                    onChange={(event) => setField('bb_packages_total', event.target.value)}
                  />
                </Field>
                <Field label="Weight (Ton)">
                  <Input
                    type="number"
                    value={form.bb_weight_ton ?? ''}
                    onChange={(event) => setField('bb_weight_ton', event.target.value)}
                  />
                </Field>
              </>
            ) : null}
            <Field label="Place of Delivery">
              <Input
                value={form.place_of_delivery ?? ''}
                onChange={(event) => setField('place_of_delivery', event.target.value)}
              />
            </Field>
            <Field label="Shipper">
              <Input value={form.shipper ?? ''} onChange={(event) => setField('shipper', event.target.value)} />
            </Field>
            <Field label="Consignatario">
              <Input value={form.consignee ?? ''} onChange={(event) => setField('consignee', event.target.value)} />
            </Field>
            <Field label="Notify Party">
              <Input
                value={form.notify_party ?? ''}
                onChange={(event) => setField('notify_party', event.target.value)}
              />
            </Field>
            {isContainerMode ? (
              <Field label="Peso total (kg)">
                <Input
                  type="number"
                  value={form.total_weight_kg ?? ''}
                  onChange={(event) => setField('total_weight_kg', event.target.value)}
                />
              </Field>
            ) : null}
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
                <option value="">Nao informado</option>
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
            <Field label="Status de revisao">
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
            <Field label="Descricao da carga">
              <Textarea
                value={form.cargo_description ?? ''}
                onChange={(event) => setField('cargo_description', event.target.value)}
              />
            </Field>
            <Field label="Notas">
              <Textarea value={form.notes ?? ''} onChange={(event) => setField('notes', event.target.value)} />
            </Field>
            <Field label="Justificativa da alteracao manual">
              <Textarea value={justification} onChange={(event) => setJustification(event.target.value)} required />
            </Field>
          </div>

          <div className="mt-5 flex justify-end">
            <Button loading={saving} type="submit">
              <Save size={16} />
              Salvar alteracoes
            </Button>
          </div>
        </Card>
      </form>

      <div className="mt-5 grid gap-5">
        <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-white">Financeiro e cliente</h2>
          <dl className="grid gap-3 text-sm">
            <InfoLine label="Modo de carga" value={cargoModeLabel(cargoMode)} />
            <InfoLine label="CE Mercante" value={bl.ce_mercante ?? '-'} />
            <InfoLine label="Cliente" value={bl.customer?.name ?? 'Nao vinculado'} />
            <InfoLine label="CNPJ/CPF" value={bl.customer?.cnpj_cpf ?? '-'} />
            <InfoLine label="Saldo pendente" value={formatBRL(bl.customer?.pending_balance ?? 0)} />
            <InfoLine label="Trecho" value={`${bl.pol ?? '-'} -> ${bl.pod ?? '-'}`} />
            <InfoLine
              label={isContainerMode ? 'Containers distintos' : 'Packages total'}
              value={String(isContainerMode ? containerSummary.distinct : breakbulkSummary.packagesTotal)}
            />
          </dl>
        </Card>

        <Card>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Taxas Locais</h2>
              <div className="mt-1 text-sm text-slate-400">
                Motor Etapa A: calculo automatico por B/L com base em POD, modo de carga e perfil IMO/OOG.
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => handleCalculateLocalCharges(false)}
                loading={calculateLocalChargesMutation.isPending}
                disabled={calculateLocalChargesMutation.isPending}
                type="button"
              >
                <Calculator size={16} />
                Calcular taxas
              </Button>
              <Button
                onClick={() => handleCalculateLocalCharges(true)}
                loading={calculateLocalChargesMutation.isPending}
                disabled={calculateLocalChargesMutation.isPending}
                type="button"
              >
                <RotateCcw size={16} />
                Recalcular taxas
              </Button>
              <Button
                variant="secondary"
                onClick={handleMarkChargesReviewed}
                loading={markReviewedMutation.isPending}
                disabled={markReviewedMutation.isPending || markReadyForBillingMutation.isPending}
                type="button"
              >
                Marcar revisado
              </Button>
              <Button
                onClick={handleMarkReadyForBilling}
                loading={markReadyForBillingMutation.isPending}
                disabled={markReadyForBillingMutation.isPending || markReviewedMutation.isPending}
                type="button"
              >
                Pronto para faturar
              </Button>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            <Badge tone={resolveChargeStatusTone(bl.charge_status)}>{resolveChargeStatusLabel(bl.charge_status)}</Badge>
            <Badge tone="green">Subtotal BRL: {formatBRL(localChargeSummary.totalBrl)}</Badge>
            <Badge tone="blue">Subtotal USD: {formatUSD(localChargeSummary.totalUsd)}</Badge>
            {localChargeSummary.hasReviewRequired ? <Badge tone="yellow">Com pendencias de revisao</Badge> : null}
            {bl.charge_exemption_reason ? <Badge tone="slate">{bl.charge_exemption_reason}</Badge> : null}
          </div>

          <div className="mb-4 rounded-xl border border-[#30363d] bg-[#0d1117] p-4">
            <div className="mb-3 text-sm font-semibold text-white">Other Charges manuais</div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <Field label="Item">
                <Select
                  value={manualChargeForm.chargeItemId}
                  onChange={(event) =>
                    setManualChargeForm((current) => ({
                      ...current,
                      chargeItemId: event.target.value,
                    }))
                  }
                  disabled={isManualChargeItemsLoading || Boolean(manualChargeForm.editingChargeCalculationId)}
                >
                  <option value="">Selecione</option>
                  {(manualChargeItems ?? []).map((item) => (
                    <option key={item.charge_item_id} value={item.charge_item_id}>
                      {item.charge_item_name} ({item.currency}){' '}
                      {item.currency === 'USD'
                        ? formatUSD(item.effective_unit_value_usd ?? 0)
                        : formatBRL(item.effective_unit_value_brl ?? 0)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Quantidade">
                <Input
                  value={manualChargeForm.quantity}
                  onChange={(event) =>
                    setManualChargeForm((current) => ({
                      ...current,
                      quantity: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Observacao">
                <Input
                  value={manualChargeForm.notes}
                  onChange={(event) =>
                    setManualChargeForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  placeholder="Justificativa operacional"
                />
              </Field>
              <div className="flex items-end gap-2 xl:col-span-2">
                <Button
                  type="button"
                  onClick={handleSaveManualCharge}
                  loading={addManualChargeMutation.isPending || updateManualChargeMutation.isPending}
                  disabled={deleteManualChargeMutation.isPending}
                >
                  {manualChargeForm.editingChargeCalculationId ? <Pencil size={16} /> : <Save size={16} />}
                  {manualChargeForm.editingChargeCalculationId ? 'Salvar edicao' : 'Adicionar other charge'}
                </Button>
                {manualChargeForm.editingChargeCalculationId ? (
                  <Button variant="ghost" type="button" onClick={handleCancelManualChargeEdit}>
                    <X size={15} />
                    Cancelar
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="app-table-scroll">
            <table className="app-table app-table--compact min-w-[980px] text-left text-sm">
              <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-2">Taxa</th>
                  <th className="py-2">Origem</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Qtd.</th>
                  <th className="py-2">Moeda</th>
                  <th className="py-2">Unitario</th>
                  <th className="py-2">Total</th>
                  <th className="py-2">Observacao</th>
                  <th className="py-2">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]">
                {isLocalChargeLinesLoading ? (
                  <tr>
                    <td className="py-3 text-slate-400" colSpan={9}>
                      Carregando linhas de taxas...
                    </td>
                  </tr>
                ) : localChargeSummary.lines.length ? (
                  localChargeSummary.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="py-2 font-semibold text-white">{line.charge_name}</td>
                      <td className="py-2">{line.source ?? '-'}</td>
                      <td className="py-2">
                        <Badge tone={resolveChargeLineStatusTone(line.status)}>{resolveChargeLineStatusLabel(line.status)}</Badge>
                      </td>
                      <td className="py-2">{formatNumber(line.quantity)}</td>
                      <td className="py-2">{line.currency ?? '-'}</td>
                      <td className="py-2">
                        {line.currency === 'USD'
                          ? formatUSD(line.unit_value_usd ?? 0)
                          : formatBRL(line.unit_value_brl ?? 0)}
                      </td>
                      <td className="py-2">
                        {line.currency === 'USD'
                          ? formatUSD(line.total_value_usd ?? 0)
                          : formatBRL(line.total_value_brl ?? 0)}
                      </td>
                      <td className="py-2">{line.review_reason ?? line.notes ?? '-'}</td>
                      <td className="py-2">
                        {line.source === 'manual' ? (
                          <div className="flex items-center gap-2">
                            <button
                              className="app-table__icon-button"
                              type="button"
                              onClick={() => handleEditManualCharge(line.id)}
                              title="Editar linha manual"
                              aria-label="Editar linha manual"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              className="app-table__icon-button app-table__icon-button--danger"
                              type="button"
                              onClick={() => handleDeleteManualCharge(line.id)}
                              title="Excluir linha manual"
                              aria-label="Excluir linha manual"
                              disabled={deleteManualChargeMutation.isPending}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ) : (
                          '-'
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="py-3 text-slate-400" colSpan={9}>
                      Nenhuma taxa calculada ainda para este B/L.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
        </div>

        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">
              {isContainerMode ? 'Containers vinculados' : 'Resumo da carga solta'}
            </h2>
            {isContainerMode ? (
              <div className="flex flex-wrap gap-2">
                <Badge tone="blue">{containerSummary.distinct} CNTRS</Badge>
                <Badge tone="red">{containerSummary.imo} IMO</Badge>
                <Badge tone="yellow">{containerSummary.oog} OOG</Badge>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Badge tone="green">{formatNumber(breakbulkSummary.machines)} maquinas</Badge>
                <Badge tone="blue">{formatNumber(breakbulkSummary.packagesTotal)} packages total</Badge>
                <Badge tone="yellow">{formatNumber(breakbulkSummary.weightTon)} ton</Badge>
                <Badge tone="slate">{formatNumber(breakbulkSummary.cbm)} CBM</Badge>
              </div>
            )}
          </div>

          <div className="app-table-scroll">
            {isContainerMode ? (
              <table className="app-table app-table--compact app-table--dense w-full table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-[26%]" />
                  <col className="w-[16%]" />
                  <col className="w-[10%]" />
                  <col className="w-[18%]" />
                  <col className="w-[12%]" />
                  <col className="w-[9%]" />
                  <col className="w-[9%]" />
                </colgroup>
                <thead className="bg-[#0d1117] text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">No. Container</th>
                    <th className="py-2">Seal</th>
                    <th className="py-2">Tipo</th>
                    <th className="py-2">Peso bruto</th>
                    <th className="py-2">CBM</th>
                    <th className="py-2">OOG</th>
                    <th className="py-2">IMO</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363d]">
                  {bl.bl_containers?.length ? (
                    bl.bl_containers.map((container) => (
                      <tr key={container.id}>
                        <td className="py-2 font-semibold text-white">{container.container_number}</td>
                        <td className="py-2">{container.seal_number ?? '-'}</td>
                        <td className="py-2">{container.type ?? '-'}</td>
                        <td className="py-2">{formatNumber(container.gross_weight_kg)} kg</td>
                        <td className="py-2">{formatNumber(container.cbm)}</td>
                        <td className="py-2">{container.is_oog ? <Badge tone="yellow">OOG</Badge> : '-'}</td>
                        <td className="py-2">{container.is_imo ? <Badge tone="red">IMO</Badge> : '-'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="py-3 text-slate-400" colSpan={7}>
                        Nenhum container vinculado a este B/L.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              <div className="grid gap-4">
                <table className="app-table app-table--compact app-table--dense w-full table-fixed text-left text-sm">
                  <thead className="bg-[#0d1117] text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-2">CE</th>
                      <th className="py-2">Maquinas</th>
                      <th className="py-2">Packages</th>
                      <th className="py-2">Packages Total</th>
                      <th className="py-2">Weight (Ton)</th>
                      <th className="py-2">CBM (M3)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#30363d]">
                    <tr>
                      <td className="py-2">{bl.ce_mercante ?? '-'}</td>
                      <td className="py-2">{formatNumber(bl.bb_machine_qty)}</td>
                      <td className="py-2">{formatNumber(bl.bb_packages_qty)}</td>
                      <td className="py-2">{formatNumber(bl.bb_packages_total ?? bl.bb_packages_qty)}</td>
                      <td className="py-2">{formatNumber(bl.bb_weight_ton ?? (bl.total_weight_kg ? Number(bl.total_weight_kg) / 1000 : null))}</td>
                      <td className="py-2">{formatNumber(bl.total_cbm)}</td>
                    </tr>
                  </tbody>
                </table>

                <table className="app-table app-table--compact app-table--dense w-full table-fixed text-left text-sm">
                  <thead className="bg-[#0d1117] text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-2">Shipper</th>
                      <th className="py-2">Consignee</th>
                      <th className="py-2">Notify</th>
                      <th className="py-2">POL</th>
                      <th className="py-2">POD</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#30363d]">
                    <tr>
                      <td className="py-2">{bl.shipper ?? '-'}</td>
                      <td className="py-2">{bl.customer?.name ?? bl.consignee ?? '-'}</td>
                      <td className="py-2">{bl.notify_party ?? '-'}</td>
                      <td className="py-2">{bl.pol ?? '-'}</td>
                      <td className="py-2">{bl.pod ?? '-'}</td>
                    </tr>
                  </tbody>
                </table>

                {bl.bl_breakbulk_items?.length ? (
                  <div>
                    <div className="mb-2 text-sm font-semibold text-slate-300">Itens legados vinculados</div>
                    <table className="app-table app-table--compact app-table--dense w-full table-fixed text-left text-sm">
                      <thead className="bg-[#0d1117] text-xs uppercase text-slate-500">
                        <tr>
                          <th className="py-2">Descricao</th>
                          <th className="py-2">Volumes</th>
                          <th className="py-2">Unidade</th>
                          <th className="py-2">Peso bruto</th>
                          <th className="py-2">CBM</th>
                          <th className="py-2">Marcas</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#30363d]">
                        {bl.bl_breakbulk_items.map((item) => (
                          <tr key={item.id}>
                            <td className="py-2 font-semibold text-white">{item.item_description}</td>
                            <td className="py-2">{formatNumber(item.package_qty)}</td>
                            <td className="py-2">{item.package_unit ?? '-'}</td>
                            <td className="py-2">{formatNumber(item.gross_weight_kg)} kg</td>
                            <td className="py-2">{formatNumber(item.cbm)}</td>
                            <td className="py-2">{item.marks ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-sm text-slate-400">
                    Este manifesto BB esta no layout resumido por B/L e nao possui itens individuais detalhados.
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        {isContainerMode ? (
          <Card>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">Veiculos vinculados</h2>
              <div className="w-full max-w-xs">
                <Field label="Buscar por chassi">
                  <Input value={vehicleSearch} onChange={(event) => setVehicleSearch(event.target.value)} />
                </Field>
              </div>
            </div>

            <div className="app-table-scroll">
              <table className="app-table app-table--compact min-w-[760px] text-left text-sm whitespace-nowrap">
                <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="py-2">Chassi</th>
                    <th className="py-2">Marca</th>
                    <th className="py-2">Container</th>
                    <th className="py-2">Peso</th>
                    <th className="py-2">Cubagem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363d]">
                  {filteredVehicles.length ? (
                    filteredVehicles.map((vehicle) => (
                      <tr key={vehicle.id}>
                        <td className="py-2 font-semibold text-white">{vehicle.chassis}</td>
                        <td className="py-2">{vehicle.brand}</td>
                        <td className="py-2">{vehicle.container?.container_number ?? '-'}</td>
                        <td className="py-2">{formatNumber(vehicle.weight_kg)} kg</td>
                        <td className="py-2">{formatNumber(vehicle.cbm)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="py-3 text-slate-400" colSpan={5}>
                        Nenhum veiculo vinculado para este B/L.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        <Card>
          <h2 className="mb-4 text-lg font-semibold text-white">Auditoria</h2>
          <div className="grid gap-3">
            {auditLogs?.length ? null : <div className="text-sm text-slate-400">Nenhuma alteracao auditada ainda.</div>}
            {auditLogs?.map((log) => (
              <div key={log.id} className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-sm">
                <div className="font-semibold text-white">
                  {log.field_name}: {log.old_value || '-'} {'->'} {log.new_value || '-'}
                </div>
                <div className="mt-1 text-slate-400">
                  {formatDate(log.changed_at)} {'|'} {log.justification ?? 'Sem justificativa'}
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
    ce_mercante: bl.ce_mercante,
    bb_machine_qty: bl.bb_machine_qty,
    bb_packages_qty: bl.bb_packages_qty,
    bb_packages_total: bl.bb_packages_total,
    bb_weight_ton: bl.bb_weight_ton ?? (bl.total_weight_kg ? Number(bl.total_weight_kg) / 1000 : null),
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

function resolveCargoMode(bl?: BLDetail | null): CargoMode {
  if (bl?.cargo_mode === 'carga_solta') return 'carga_solta'
  if (bl?.cargo_mode === 'container') return 'container'
  if ((bl?.bl_breakbulk_items?.length ?? 0) > 0) return 'carga_solta'
  return 'container'
}

function cargoModeLabel(mode: CargoMode) {
  return mode === 'carga_solta' ? 'Carga Solta' : 'Container'
}

function stringifyValue(value: unknown) {
  return value === null || value === undefined ? '' : String(value)
}

function normalizeFormValue(field: keyof BlForm, value: unknown) {
  if (
    ['bb_machine_qty', 'bb_packages_qty', 'bb_packages_total', 'bb_weight_ton', 'total_weight_kg', 'total_cbm', 'free_time_override'].includes(
      field,
    )
  ) {
    if (value === '' || value === null || value === undefined) return null
    const parsed = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(parsed) ? parsed : INVALID_NUMERIC_VALUE
  }

  return value === '' ? null : value
}

function formatNumber(value: number | string | null | undefined) {
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) ? amount.toLocaleString('pt-BR') : '0'
}

function formatUSD(value: number | null | undefined) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0))
}

function resolveChargeStatusTone(status: BL['charge_status']) {
  if (status === 'review_required') return 'yellow'
  if (status === 'ready_for_billing' || status === 'reviewed' || status === 'calculated') return 'green'
  if (status === 'exempt') return 'slate'
  return 'blue'
}

function resolveChargeStatusLabel(status: BL['charge_status']) {
  switch (status) {
    case 'calculated':
      return 'Calculado'
    case 'review_required':
      return 'Revisao obrigatoria'
    case 'reviewed':
      return 'Revisado'
    case 'ready_for_billing':
      return 'Pronto para faturar'
    case 'exempt':
      return 'Isento'
    default:
      return 'Nao calculado'
  }
}

function resolveChargeLineStatusTone(status: string | null) {
  if (status === 'review_required') return 'yellow'
  if (status === 'exempt') return 'slate'
  if (status === 'reviewed' || status === 'ready_for_billing' || status === 'calculated') return 'green'
  return 'blue'
}

function resolveChargeLineStatusLabel(status: string | null) {
  switch (status) {
    case 'calculated':
      return 'Calculado'
    case 'review_required':
      return 'Revisao'
    case 'reviewed':
      return 'Revisado'
    case 'ready_for_billing':
      return 'Pronto'
    case 'exempt':
      return 'Isento'
    default:
      return 'Pendente'
  }
}

function StatusBadge({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'blue' | 'green' | 'red' | 'yellow' | 'slate'
}) {
  const resolvedTone =
    tone ??
    (value.includes('pending')
      ? 'yellow'
      : value.includes('paid') || value.includes('reviewed')
        ? 'green'
        : 'blue')

  return (
    <Badge tone={resolvedTone}>
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
