import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calculator, Pencil, RefreshCw, Save, Trash2, X } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { Field, Input, Select, Textarea } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import {
  useBlLocalChargeLines,
  useManualChargeItemsForBl,
  useCalculateBlLocalCharges,
  useChargePendencies,
  useAddManualBlCharge,
  useDeleteManualBlCharge,
  useMarkBlChargesReviewed,
  useMarkBlReadyForBilling,
  useUpdateManualBlCharge,
  useCustomerRateOverrides,
  useDeleteCustomerRateOverride,
  useLocalChargeTables,
  useOverrideChargeItems,
  useOverrideCustomers,
  useSaveCustomerRateOverride,
} from '../hooks/useLocalCharges'
import { formatBRL } from '../lib/utils'

type LocalChargeTab = 'tabelas' | 'overrides' | 'pendencias' | 'simulacao'

type OverrideForm = {
  id: number | null
  customerId: string
  chargeItemId: string
  overrideValue: string
  validFrom: string
  validTo: string
  notes: string
}

type ManualChargeForm = {
  chargeItemId: string
  quantity: string
  notes: string
  editingChargeCalculationId: number | null
}

const EMPTY_OVERRIDE_FORM: OverrideForm = {
  id: null,
  customerId: '',
  chargeItemId: '',
  overrideValue: '',
  validFrom: '',
  validTo: '',
  notes: '',
}

const EMPTY_MANUAL_CHARGE_FORM: ManualChargeForm = {
  chargeItemId: '',
  quantity: '1',
  notes: '',
  editingChargeCalculationId: null,
}

export function TaxasLocais() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [tab, setTab] = useState<LocalChargeTab>('tabelas')
  const [cargoModeFilter, setCargoModeFilter] = useState<'' | 'container' | 'carga_solta'>('')
  const [podFilter, setPodFilter] = useState('')
  const [overrideCustomerSearch, setOverrideCustomerSearch] = useState('')
  const [overrideForm, setOverrideForm] = useState<OverrideForm>(EMPTY_OVERRIDE_FORM)
  const [overrideSaving, setOverrideSaving] = useState(false)
  const [overrideDeletingId, setOverrideDeletingId] = useState<number | null>(null)
  const [simulationBlIdInput, setSimulationBlIdInput] = useState('')
  const [simulationBlId, setSimulationBlId] = useState('')
  const [manualChargeForm, setManualChargeForm] = useState<ManualChargeForm>(EMPTY_MANUAL_CHARGE_FORM)
  const { data: tables, isLoading: tablesLoading, error: tablesError } = useLocalChargeTables({
    cargoMode: cargoModeFilter,
    pod: podFilter,
  })
  const { data: overrideRows, isLoading: overridesLoading, error: overridesError } = useCustomerRateOverrides({
    customerSearch: overrideCustomerSearch,
    cargoMode: cargoModeFilter,
    pod: podFilter,
    limit: 300,
  })
  const { data: overrideChargeItems } = useOverrideChargeItems()
  const { data: overrideCustomers } = useOverrideCustomers(overrideCustomerSearch)
  const saveOverrideMutation = useSaveCustomerRateOverride()
  const deleteOverrideMutation = useDeleteCustomerRateOverride()
  const { data: pendencies, isLoading: pendenciesLoading, error: pendenciesError } = useChargePendencies(200)
  const { data: simulationLines, isLoading: simulationLinesLoading } = useBlLocalChargeLines(simulationBlId)
  const { data: manualChargeItems, isLoading: isManualChargeItemsLoading } = useManualChargeItemsForBl(simulationBlId)
  const calculateMutation = useCalculateBlLocalCharges(simulationBlId)
  const addManualChargeMutation = useAddManualBlCharge(simulationBlId)
  const updateManualChargeMutation = useUpdateManualBlCharge(simulationBlId)
  const deleteManualChargeMutation = useDeleteManualBlCharge(simulationBlId)
  const markReviewedMutation = useMarkBlChargesReviewed(simulationBlId)
  const markReadyMutation = useMarkBlReadyForBilling(simulationBlId)

  const tableSummary = useMemo(() => {
    const currentTables = tables ?? []
    return {
      tables: currentTables.length,
      active: currentTables.filter((item) => item.active).length,
      items: currentTables.reduce((sum, item) => sum + (item.charge_table_items?.length ?? 0), 0),
      manualOnly: currentTables.reduce(
        (sum, item) => sum + (item.charge_table_items?.filter((row) => row.manual_only).length ?? 0),
        0,
      ),
    }
  }, [tables])

  const simulationTotals = useMemo(() => {
    const lines = simulationLines ?? []
    return {
      brl: lines.reduce((sum, line) => sum + Number(line.total_value_brl ?? 0), 0),
      usd: lines.reduce((sum, line) => sum + Number(line.total_value_usd ?? 0), 0),
    }
  }, [simulationLines])

  async function handleSimulate(recalculate: boolean) {
    const blId = simulationBlIdInput.trim().toUpperCase()
    if (!blId) {
      showToast('Informe um B/L para simular/calcular taxas.', 'error')
      return
    }

    setSimulationBlId(blId)
    try {
      const result = await calculateMutation.mutateAsync({
        actorId: user?.id ?? null,
        recalculate,
      })

      if (result.status === 'review_required') {
        showToast('Calculo concluido com pendencia de revisao.', 'info')
        return
      }

      if (result.status === 'exempt') {
        showToast('B/L marcado como isento por regra operacional.', 'success')
        return
      }

      showToast('Calculo concluido com sucesso.', 'success')
      setManualChargeForm(EMPTY_MANUAL_CHARGE_FORM)
    } catch {
      showToast('Falha ao calcular taxas para o B/L informado.', 'error')
    }
  }

  async function handleSaveManualCharge() {
    const chargeItemId = Number(manualChargeForm.chargeItemId)
    const quantity = Number(String(manualChargeForm.quantity).replace(',', '.'))

    if (!simulationBlId) {
      showToast('Selecione um B/L antes de incluir other charge.', 'error')
      return
    }
    if (!Number.isInteger(chargeItemId) || chargeItemId <= 0) {
      showToast('Selecione um item manual de taxa.', 'error')
      return
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      showToast('Quantidade invalida para linha manual.', 'error')
      return
    }

    try {
      if (manualChargeForm.editingChargeCalculationId) {
        await updateManualChargeMutation.mutateAsync({
          chargeCalculationId: manualChargeForm.editingChargeCalculationId,
          quantity,
          notes: manualChargeForm.notes || null,
          actorId: user?.id ?? null,
        })
        showToast('Linha manual atualizada.', 'success')
      } else {
        await addManualChargeMutation.mutateAsync({
          chargeItemId,
          quantity,
          notes: manualChargeForm.notes || null,
          actorId: user?.id ?? null,
        })
        showToast('Other charge manual adicionado.', 'success')
      }
      setManualChargeForm(EMPTY_MANUAL_CHARGE_FORM)
    } catch {
      showToast('Falha ao salvar other charge manual.', 'error')
    }
  }

  function handleEditManualLine(id: number) {
    const line = (simulationLines ?? []).find((entry) => entry.id === id && entry.source === 'manual')
    if (!line) return

    setManualChargeForm({
      chargeItemId: String(line.charge_item_id ?? ''),
      quantity: String(Number(line.quantity ?? 1)),
      notes: line.notes ?? '',
      editingChargeCalculationId: line.id,
    })
  }

  function handleCancelManualEdit() {
    setManualChargeForm(EMPTY_MANUAL_CHARGE_FORM)
  }

  async function handleDeleteManualLine(id: number) {
    if (!window.confirm('Excluir esta linha manual?')) return
    try {
      await deleteManualChargeMutation.mutateAsync({
        chargeCalculationId: id,
        actorId: user?.id ?? null,
      })
      showToast('Linha manual removida.', 'success')
      if (manualChargeForm.editingChargeCalculationId === id) {
        setManualChargeForm(EMPTY_MANUAL_CHARGE_FORM)
      }
    } catch {
      showToast('Falha ao remover linha manual.', 'error')
    }
  }

  async function handleMarkReviewed() {
    if (!simulationBlId) {
      showToast('Informe um B/L para marcar revisao.', 'error')
      return
    }
    try {
      await markReviewedMutation.mutateAsync({ actorId: user?.id ?? null })
      showToast('B/L marcado como revisado.', 'success')
    } catch {
      showToast('Falha ao marcar revisado.', 'error')
    }
  }

  async function handleMarkReady() {
    if (!simulationBlId) {
      showToast('Informe um B/L para marcar pronto faturar.', 'error')
      return
    }
    try {
      await markReadyMutation.mutateAsync({ actorId: user?.id ?? null })
      showToast('B/L marcado como pronto para faturar.', 'success')
    } catch (error) {
      const message = String((error as { message?: string }).message ?? '').toLowerCase()
      if (message.includes('pendencia de revisao')) {
        showToast('Ainda existem linhas em pendencia de revisao.', 'error')
        return
      }
      showToast('Falha ao marcar pronto para faturar.', 'error')
    }
  }

  async function handleSaveOverride() {
    const customerId = Number(overrideForm.customerId)
    const chargeItemId = Number(overrideForm.chargeItemId)
    const overrideValue = Number(String(overrideForm.overrideValue).replace(',', '.'))

    if (!Number.isInteger(customerId) || customerId <= 0) {
      showToast('Selecione um cliente para salvar o override.', 'error')
      return
    }
    if (!Number.isInteger(chargeItemId) || chargeItemId <= 0) {
      showToast('Selecione um item de taxa para salvar o override.', 'error')
      return
    }
    if (!Number.isFinite(overrideValue) || overrideValue <= 0) {
      showToast('Informe um valor de override valido (maior que zero).', 'error')
      return
    }
    if (overrideForm.validFrom && overrideForm.validTo && overrideForm.validTo < overrideForm.validFrom) {
      showToast('A vigencia final nao pode ser anterior a vigencia inicial.', 'error')
      return
    }

    setOverrideSaving(true)
    try {
      await saveOverrideMutation.mutateAsync({
        id: overrideForm.id,
        customerId,
        chargeItemId,
        overrideValue,
        validFrom: overrideForm.validFrom || null,
        validTo: overrideForm.validTo || null,
        notes: overrideForm.notes || null,
      })

      showToast(overrideForm.id ? 'Override atualizado com sucesso.' : 'Override criado com sucesso.', 'success')
      setOverrideForm(EMPTY_OVERRIDE_FORM)
    } catch {
      showToast('Falha ao salvar override de cliente.', 'error')
    } finally {
      setOverrideSaving(false)
    }
  }

  function handleEditOverride(id: number) {
    const row = overrideRows?.find((item) => item.id === id)
    if (!row) return

    setOverrideForm({
      id: row.id,
      customerId: String(row.customer_id ?? ''),
      chargeItemId: String(row.charge_item_id ?? ''),
      overrideValue: String(Number(row.override_value ?? 0)),
      validFrom: row.valid_from ?? '',
      validTo: row.valid_to ?? '',
      notes: row.notes ?? '',
    })
  }

  async function handleDeleteOverride(id: number) {
    if (!window.confirm('Excluir este override de cliente?')) return
    setOverrideDeletingId(id)
    try {
      await deleteOverrideMutation.mutateAsync(id)
      showToast('Override removido.', 'success')
      if (overrideForm.id === id) {
        setOverrideForm(EMPTY_OVERRIDE_FORM)
      }
    } catch {
      showToast('Falha ao remover override.', 'error')
    } finally {
      setOverrideDeletingId(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Taxas Locais"
        description="Etapa A: motor de calculo por POD/cargo mode, pendencias de revisao e simulacao por B/L."
      />

      <div className="mb-5 flex flex-wrap gap-2">
        <TabButton active={tab === 'tabelas'} label="Tabelas" onClick={() => setTab('tabelas')} />
        <TabButton active={tab === 'overrides'} label="Overrides" onClick={() => setTab('overrides')} />
        <TabButton active={tab === 'pendencias'} label="Pendencias" onClick={() => setTab('pendencias')} />
        <TabButton active={tab === 'simulacao'} label="Simulacao" onClick={() => setTab('simulacao')} />
      </div>

      {tab === 'tabelas' ? (
        <>
          <Card className="mb-5">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Modo de carga">
                <Select value={cargoModeFilter} onChange={(event) => setCargoModeFilter(event.target.value as '' | 'container' | 'carga_solta')}>
                  <option value="">Todos</option>
                  <option value="container">Container</option>
                  <option value="carga_solta">Carga Solta</option>
                </Select>
              </Field>
              <Field label="POD">
                <Input value={podFilter} onChange={(event) => setPodFilter(event.target.value.toUpperCase())} placeholder="BRVIT / BRSSA" />
              </Field>
              <MetricCard label="Tabelas" value={String(tableSummary.tables)} />
              <MetricCard label="Itens ativos" value={String(tableSummary.items - tableSummary.manualOnly)} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge tone="green">{tableSummary.active} tabela(s) ativa(s)</Badge>
              <Badge tone="blue">{tableSummary.items} item(ns) total</Badge>
              <Badge tone="slate">{tableSummary.manualOnly} other charge(s) manual(is)</Badge>
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            {tablesError ? (
              <div className="p-5 text-sm text-amber-200">
                Nao foi possivel consultar tabelas de taxas locais. Se voce for operador, este acesso pode estar restrito por role.
              </div>
            ) : null}
            <div className="app-table-scroll">
              <table className="app-table app-table--compact min-w-[1180px] text-left text-sm whitespace-nowrap">
                <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Tabela</th>
                    <th className="px-4 py-3">Modo</th>
                    <th className="px-4 py-3">POD</th>
                    <th className="px-4 py-3">Vigencia</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Itens</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363d]">
                  {tablesLoading ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-slate-400" colSpan={6}>
                        Carregando tabelas...
                      </td>
                    </tr>
                  ) : null}
                  {!tablesLoading && (tables?.length ?? 0) === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-slate-400" colSpan={6}>
                        Nenhuma tabela encontrada.
                      </td>
                    </tr>
                  ) : null}
                  {tables?.map((table) => (
                    <tr key={table.id}>
                      <td className="px-4 py-3 font-semibold text-white">{table.name}</td>
                      <td className="px-4 py-3">{table.cargo_mode === 'carga_solta' ? 'Carga Solta' : 'Container'}</td>
                      <td className="px-4 py-3">{table.pod ?? '-'}</td>
                      <td className="px-4 py-3">
                        {table.valid_from} {table.valid_to ? `ate ${table.valid_to}` : '(aberta)'}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={table.active ? 'green' : 'slate'}>{table.active ? 'Ativa' : 'Inativa'}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {table.charge_table_items?.slice(0, 6).map((item) => (
                            <Badge key={item.id} tone={item.manual_only ? 'slate' : 'blue'}>
                              {item.name} {item.currency === 'USD' ? formatUSD(item.unit_value_usd ?? 0) : formatBRL(item.unit_value_brl ?? 0)}
                            </Badge>
                          ))}
                          {(table.charge_table_items?.length ?? 0) > 6 ? <Badge tone="slate">+{(table.charge_table_items?.length ?? 0) - 6}</Badge> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}

      {tab === 'pendencias' ? (
        <Card className="overflow-hidden p-0">
          {pendenciesError ? <div className="p-5 text-sm text-red-200">Falha ao carregar pendencias de taxas locais.</div> : null}
          <div className="app-table-scroll">
            <table className="app-table app-table--compact min-w-[980px] text-left text-sm whitespace-nowrap">
              <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">B/L</th>
                  <th className="px-4 py-3">Modo</th>
                  <th className="px-4 py-3">Navio/Viagem</th>
                  <th className="px-4 py-3">Trecho</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Acao</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]">
                {pendenciesLoading ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-400" colSpan={7}>
                      Carregando pendencias...
                    </td>
                  </tr>
                ) : null}
                {!pendenciesLoading && (pendencies?.length ?? 0) === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-400" colSpan={7}>
                      Nao ha pendencias de taxas locais.
                    </td>
                  </tr>
                ) : null}
                {pendencies?.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 font-semibold text-[#58a6ff]">{row.id}</td>
                    <td className="px-4 py-3">{row.cargo_mode === 'carga_solta' ? 'Carga Solta' : 'Container'}</td>
                    <td className="px-4 py-3">
                      {row.voyage?.vessel?.name ?? '-'} / {row.voyage?.voyage_number ?? '-'}
                    </td>
                    <td className="px-4 py-3">
                      {row.pol ?? '-'} - {row.pod ?? '-'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone="yellow">{row.charge_status === 'not_calculated' ? 'Nao calculado' : 'Revisao'}</Badge>
                    </td>
                    <td className="px-4 py-3">{row.customer?.name ?? '-'}</td>
                    <td className="px-4 py-3">
                      <Link className="app-table__action" to={`/manifestos/${row.id}`}>
                        Abrir B/L
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {tab === 'overrides' ? (
        <>
          <Card className="mb-5">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Buscar cliente">
                <Input
                  value={overrideCustomerSearch}
                  onChange={(event) => setOverrideCustomerSearch(event.target.value)}
                  placeholder="Razao social ou CNPJ"
                />
              </Field>
              <Field label="Modo de carga">
                <Select value={cargoModeFilter} onChange={(event) => setCargoModeFilter(event.target.value as '' | 'container' | 'carga_solta')}>
                  <option value="">Todos</option>
                  <option value="container">Container</option>
                  <option value="carga_solta">Carga Solta</option>
                </Select>
              </Field>
              <Field label="POD">
                <Input value={podFilter} onChange={(event) => setPodFilter(event.target.value.toUpperCase())} placeholder="BRVIT / BRSSA" />
              </Field>
              <MetricCard label="Overrides encontrados" value={String(overrideRows?.length ?? 0)} />
            </div>
          </Card>

          <Card className="mb-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-white">{overrideForm.id ? 'Editar override' : 'Novo override'}</h3>
              {overrideForm.id ? (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => setOverrideForm(EMPTY_OVERRIDE_FORM)}
                >
                  <X size={15} />
                  Cancelar edicao
                </Button>
              ) : null}
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Cliente">
                <Select
                  value={overrideForm.customerId}
                  onChange={(event) => setOverrideForm((prev) => ({ ...prev, customerId: event.target.value }))}
                >
                  <option value="">Selecione</option>
                  {(overrideCustomers ?? []).map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name} ({customer.cnpj_cpf})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Item de taxa">
                <Select
                  value={overrideForm.chargeItemId}
                  onChange={(event) => setOverrideForm((prev) => ({ ...prev, chargeItemId: event.target.value }))}
                >
                  <option value="">Selecione</option>
                  {(overrideChargeItems ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.charge_table?.cargo_mode === 'carga_solta' ? 'BB' : 'CNTR'} | {item.charge_table?.pod ?? '-'} | {item.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Valor override">
                <Input
                  value={overrideForm.overrideValue}
                  onChange={(event) => setOverrideForm((prev) => ({ ...prev, overrideValue: event.target.value }))}
                  placeholder="Ex: 1500.00"
                />
              </Field>
              <Field label="Vigencia inicial">
                <Input
                  type="date"
                  value={overrideForm.validFrom}
                  onChange={(event) => setOverrideForm((prev) => ({ ...prev, validFrom: event.target.value }))}
                />
              </Field>
              <Field label="Vigencia final">
                <Input
                  type="date"
                  value={overrideForm.validTo}
                  onChange={(event) => setOverrideForm((prev) => ({ ...prev, validTo: event.target.value }))}
                />
              </Field>
              <Field label="Observacoes">
                <Textarea
                  value={overrideForm.notes}
                  onChange={(event) => setOverrideForm((prev) => ({ ...prev, notes: event.target.value }))}
                />
              </Field>
            </div>
            <div className="mt-4 flex justify-end">
              <Button type="button" onClick={handleSaveOverride} loading={overrideSaving || saveOverrideMutation.isPending}>
                <Save size={15} />
                {overrideForm.id ? 'Salvar override' : 'Criar override'}
              </Button>
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            {overridesError ? <div className="p-5 text-sm text-red-200">Falha ao consultar overrides.</div> : null}
            <div className="app-table-scroll">
              <table className="app-table app-table--compact min-w-[1220px] text-left text-sm whitespace-nowrap">
                <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-4 py-3">Taxa</th>
                    <th className="px-4 py-3">Modo/POD</th>
                    <th className="px-4 py-3">Vigencia</th>
                    <th className="px-4 py-3">Valor base</th>
                    <th className="px-4 py-3">Override</th>
                    <th className="px-4 py-3">Obs</th>
                    <th className="px-4 py-3">Acoes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363d]">
                  {overridesLoading ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-slate-400" colSpan={8}>
                        Carregando overrides...
                      </td>
                    </tr>
                  ) : null}
                  {!overridesLoading && (overrideRows?.length ?? 0) === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-slate-400" colSpan={8}>
                        Nenhum override encontrado.
                      </td>
                    </tr>
                  ) : null}
                  {overrideRows?.map((row) => {
                    const currency = row.charge_item?.currency ?? 'BRL'
                    const baseValue =
                      currency === 'USD'
                        ? Number(row.charge_item?.unit_value_usd ?? 0)
                        : Number(row.charge_item?.unit_value_brl ?? 0)
                    return (
                      <tr key={row.id}>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-white">{row.customer?.name ?? '-'}</div>
                          <div className="text-xs text-slate-400">{row.customer?.cnpj_cpf ?? '-'}</div>
                        </td>
                        <td className="px-4 py-3 font-semibold text-white">{row.charge_item?.name ?? '-'}</td>
                        <td className="px-4 py-3">
                          {(row.charge_item?.charge_table?.cargo_mode ?? '').toUpperCase()} / {row.charge_item?.charge_table?.pod ?? '-'}
                        </td>
                        <td className="px-4 py-3">
                          {row.valid_from ?? '-'} {row.valid_to ? `ate ${row.valid_to}` : '(aberta)'}
                        </td>
                        <td className="px-4 py-3">{currency === 'USD' ? formatUSD(baseValue) : formatBRL(baseValue)}</td>
                        <td className="px-4 py-3 font-semibold text-green-300">
                          {currency === 'USD' ? formatUSD(Number(row.override_value ?? 0)) : formatBRL(Number(row.override_value ?? 0))}
                        </td>
                        <td className="px-4 py-3">{row.notes ?? '-'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              className="app-table__icon-button"
                              type="button"
                              onClick={() => handleEditOverride(row.id)}
                              aria-label="Editar override"
                              title="Editar override"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              className="app-table__icon-button app-table__icon-button--danger"
                              type="button"
                              onClick={() => handleDeleteOverride(row.id)}
                              aria-label="Excluir override"
                              title="Excluir override"
                              disabled={overrideDeletingId === row.id}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}

      {tab === 'simulacao' ? (
        <>
          <Card className="mb-5">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
              <Field label="B/L para simular">
                <Input
                  value={simulationBlIdInput}
                  onChange={(event) => setSimulationBlIdInput(event.target.value.toUpperCase())}
                  placeholder="Ex: CSC45380602A00"
                />
              </Field>
              <div className="flex items-end gap-2">
                <Button onClick={() => handleSimulate(false)} loading={calculateMutation.isPending}>
                  <Calculator size={16} />
                  Calcular
                </Button>
                <Button variant="secondary" onClick={() => handleSimulate(true)} loading={calculateMutation.isPending}>
                  <RefreshCw size={16} />
                  Recalcular
                </Button>
              </div>
              <div className="flex items-end gap-2">
                <Button
                  variant="secondary"
                  onClick={handleMarkReviewed}
                  loading={markReviewedMutation.isPending}
                  disabled={!simulationBlId || markReadyMutation.isPending}
                >
                  Revisado
                </Button>
                <Button
                  onClick={handleMarkReady}
                  loading={markReadyMutation.isPending}
                  disabled={!simulationBlId || markReviewedMutation.isPending}
                >
                  Pronto faturar
                </Button>
              </div>
              <MetricCard label="Subtotal BRL" value={formatBRL(simulationTotals.brl)} />
              <MetricCard label="Subtotal USD" value={formatUSD(simulationTotals.usd)} />
              <MetricCard label="Linhas" value={String(simulationLines?.length ?? 0)} />
            </div>
          </Card>

          <Card className="mb-5">
            <div className="mb-3 text-sm font-semibold text-white">Other Charges manuais</div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <Field label="Item manual">
                <Select
                  value={manualChargeForm.chargeItemId}
                  onChange={(event) =>
                    setManualChargeForm((current) => ({
                      ...current,
                      chargeItemId: event.target.value,
                    }))
                  }
                  disabled={!simulationBlId || isManualChargeItemsLoading || Boolean(manualChargeForm.editingChargeCalculationId)}
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
                  placeholder="1"
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
                  placeholder="Justificativa"
                />
              </Field>
              <div className="flex items-end gap-2 xl:col-span-2">
                <Button
                  type="button"
                  onClick={handleSaveManualCharge}
                  loading={addManualChargeMutation.isPending || updateManualChargeMutation.isPending}
                  disabled={!simulationBlId || deleteManualChargeMutation.isPending}
                >
                  {manualChargeForm.editingChargeCalculationId ? <Pencil size={15} /> : <Save size={15} />}
                  {manualChargeForm.editingChargeCalculationId ? 'Salvar edicao' : 'Adicionar other charge'}
                </Button>
                {manualChargeForm.editingChargeCalculationId ? (
                  <Button variant="ghost" type="button" onClick={handleCancelManualEdit}>
                    <X size={15} />
                    Cancelar
                  </Button>
                ) : null}
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="app-table-scroll">
              <table className="app-table app-table--compact min-w-[980px] text-left text-sm whitespace-nowrap">
                <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Taxa</th>
                    <th className="px-4 py-3">Origem</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Qtd</th>
                    <th className="px-4 py-3">Moeda</th>
                    <th className="px-4 py-3">Unitario</th>
                    <th className="px-4 py-3">Total</th>
                    <th className="px-4 py-3">Obs</th>
                    <th className="px-4 py-3">Acoes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363d]">
                  {simulationLinesLoading ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-slate-400" colSpan={9}>
                        Carregando simulacao...
                      </td>
                    </tr>
                  ) : null}
                  {!simulationLinesLoading && (simulationLines?.length ?? 0) === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-slate-400" colSpan={9}>
                        Nenhuma linha de taxa para exibir. Informe um B/L e clique em Calcular.
                      </td>
                    </tr>
                  ) : null}
                  {simulationLines?.map((line) => (
                    <tr key={line.id}>
                      <td className="px-4 py-3 font-semibold text-white">{line.charge_name}</td>
                      <td className="px-4 py-3">{line.source ?? '-'}</td>
                      <td className="px-4 py-3">{renderChargeStatus(line.status)}</td>
                      <td className="px-4 py-3">{Number(line.quantity ?? 0).toLocaleString('pt-BR')}</td>
                      <td className="px-4 py-3">{line.currency ?? '-'}</td>
                      <td className="px-4 py-3">
                        {line.currency === 'USD' ? formatUSD(line.unit_value_usd ?? 0) : formatBRL(line.unit_value_brl ?? 0)}
                      </td>
                      <td className="px-4 py-3">
                        {line.currency === 'USD' ? formatUSD(line.total_value_usd ?? 0) : formatBRL(line.total_value_brl ?? 0)}
                      </td>
                      <td className="px-4 py-3">{line.review_reason ?? line.notes ?? '-'}</td>
                      <td className="px-4 py-3">
                        {line.source === 'manual' ? (
                          <div className="flex items-center gap-2">
                            <button
                              className="app-table__icon-button"
                              type="button"
                              onClick={() => handleEditManualLine(line.id)}
                              aria-label="Editar linha manual"
                              title="Editar linha manual"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              className="app-table__icon-button app-table__icon-button--danger"
                              type="button"
                              onClick={() => handleDeleteManualLine(line.id)}
                              aria-label="Excluir linha manual"
                              title="Excluir linha manual"
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
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}
    </>
  )
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button className={`app-tab ${active ? 'app-tab--active' : ''}`} onClick={onClick} type="button">
      {label}
    </button>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-bold text-white">{value}</div>
    </Card>
  )
}

function renderChargeStatus(status: string | null) {
  if (status === 'review_required') return <Badge tone="yellow">Revisao</Badge>
  if (status === 'ready_for_billing') return <Badge tone="green">Pronto</Badge>
  if (status === 'reviewed') return <Badge tone="green">Revisado</Badge>
  if (status === 'exempt') return <Badge tone="slate">Isento</Badge>
  if (status === 'calculated') return <Badge tone="blue">Calculado</Badge>
  return <Badge tone="slate">Pendente</Badge>
}

function formatUSD(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0))
}
