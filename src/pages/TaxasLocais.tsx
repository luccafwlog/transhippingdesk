import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input, Select, Textarea } from '../components/ui/Input'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import {
  useDeleteChargeTableItem,
  useSaveChargeTable,
  useSaveChargeTableItem,
  useSetChargeTableActive,
  useCustomerRateOverrides,
  useDeleteCustomerRateOverride,
  useLocalChargeTables,
  useOverrideChargeItems,
  useOverrideCustomers,
  useSaveCustomerRateOverride,
} from '../hooks/useLocalCharges'
import { formatBRL } from '../lib/utils'

type LocalChargeTab = 'tabelas' | 'overrides'

type OverrideForm = {
  id: number | null
  customerId: string
  chargeItemId: string
  overrideValue: string
  validFrom: string
  validTo: string
  notes: string
}

type ChargeTableForm = {
  id: number | null
  name: string
  cargoMode: 'container' | 'carga_solta' | 'granito'
  pod: string
  validFrom: string
  validTo: string
  active: boolean
  notes: string
}

type ChargeTableItemForm = {
  id: number | null
  chargeTableId: string
  name: string
  category: 'base' | 'other_charge'
  applicationBasis: 'bl' | 'container_distinct_voyage' | 'weight_ton' | 'teu'
  cargoProfile: 'standard' | 'imo' | 'oog' | 'any'
  currency: 'BRL' | 'USD'
  unitValue: string
  manualOnly: boolean
  active: boolean
  sortOrder: string
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

const EMPTY_TABLE_FORM: ChargeTableForm = {
  id: null,
  name: '',
  cargoMode: 'container',
  pod: '',
  validFrom: '',
  validTo: '',
  active: true,
  notes: '',
}

const EMPTY_TABLE_ITEM_FORM: ChargeTableItemForm = {
  id: null,
  chargeTableId: '',
  name: '',
  category: 'base',
  applicationBasis: 'bl',
  cargoProfile: 'any',
  currency: 'BRL',
  unitValue: '',
  manualOnly: false,
  active: true,
  sortOrder: '100',
}

export function TaxasLocais() {
  const { can } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const canManageTables = can('charge_tables')
  const canManageOverrides = can('charge_overrides')
  const [tab, setTab] = useState<LocalChargeTab>('tabelas')
  const [expandedTableId, setExpandedTableId] = useState<number | null>(null)
  const [cargoModeFilter, setCargoModeFilter] = useState<'' | 'container' | 'carga_solta' | 'granito'>('')
  const [podFilter, setPodFilter] = useState('')
  const [tableForm, setTableForm] = useState<ChargeTableForm>(EMPTY_TABLE_FORM)
  const [tableItemForm, setTableItemForm] = useState<ChargeTableItemForm>(EMPTY_TABLE_ITEM_FORM)
  const [overrideCustomerSearch, setOverrideCustomerSearch] = useState('')
  const [overrideForm, setOverrideForm] = useState<OverrideForm>(EMPTY_OVERRIDE_FORM)
  const [overrideSaving, setOverrideSaving] = useState(false)
  const [overrideDeletingId, setOverrideDeletingId] = useState<number | null>(null)
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
  const saveChargeTableMutation = useSaveChargeTable()
  const setChargeTableActiveMutation = useSetChargeTableActive()
  const saveChargeTableItemMutation = useSaveChargeTableItem()
  const deleteChargeTableItemMutation = useDeleteChargeTableItem()

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
      showToast('A vigência final não pode ser anterior à vigência inicial.', 'error')
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
    if (!(await confirm({ message: 'Excluir este override de cliente?', tone: 'danger', confirmLabel: 'Excluir' }))) return
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

  async function handleSaveTable() {
    if (!tableForm.name.trim()) {
      showToast('Informe o nome da tabela.', 'error')
      return
    }
    if (!tableForm.pod.trim()) {
      showToast('Informe o POD da tabela.', 'error')
      return
    }
    if (!tableForm.validFrom) {
      showToast('Informe a vigência inicial da tabela.', 'error')
      return
    }
    if (tableForm.validTo && tableForm.validTo < tableForm.validFrom) {
      showToast('Vigência final não pode ser anterior à inicial.', 'error')
      return
    }

    try {
      const savedTableId = await saveChargeTableMutation.mutateAsync({
        id: tableForm.id,
        name: tableForm.name,
        cargoMode: tableForm.cargoMode,
        pod: tableForm.pod,
        validFrom: tableForm.validFrom,
        validTo: tableForm.validTo || null,
        active: tableForm.active,
        notes: tableForm.notes || null,
      })
      showToast(tableForm.id ? 'Tabela atualizada.' : 'Tabela criada.', 'success')
      setTableForm(EMPTY_TABLE_FORM)
      setTableItemForm((current) => ({
        ...current,
        chargeTableId: String(tableForm.id ?? savedTableId),
      }))
    } catch {
      showToast('Falha ao salvar tabela.', 'error')
    }
  }

  function handleEditTable(id: number) {
    const table = (tables ?? []).find((row) => row.id === id)
    if (!table) return
    setTableForm({
      id: table.id,
      name: table.name ?? '',
      cargoMode: (table.cargo_mode ?? 'container') as 'container' | 'carga_solta' | 'granito',
      pod: table.pod ?? '',
      validFrom: table.valid_from,
      validTo: table.valid_to ?? '',
      active: Boolean(table.active),
      notes: table.notes ?? '',
    })
    setTableItemForm((current) => ({
      ...current,
      chargeTableId: String(table.id),
    }))
  }

  async function handleToggleTableActive(id: number, current: boolean | null) {
    const nextActive = current !== true
    try {
      await setChargeTableActiveMutation.mutateAsync({ id, active: nextActive })
      showToast(nextActive ? 'Tabela ativada.' : 'Tabela inativada.', 'success')
    } catch {
      showToast('Falha ao alterar status da tabela.', 'error')
    }
  }

  async function handleSaveTableItem() {
    const chargeTableId = Number(tableItemForm.chargeTableId)
    const unitValue = Number(String(tableItemForm.unitValue).replace(',', '.'))
    const sortOrder = Number(tableItemForm.sortOrder)

    if (!Number.isInteger(chargeTableId) || chargeTableId <= 0) {
      showToast('Selecione a tabela do item.', 'error')
      return
    }
    if (!tableItemForm.name.trim()) {
      showToast('Informe o nome do item de taxa.', 'error')
      return
    }
    if (!Number.isFinite(unitValue) || unitValue < 0) {
      showToast('Valor unitario invalido.', 'error')
      return
    }
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      showToast('Sort order invalido.', 'error')
      return
    }

    try {
      await saveChargeTableItemMutation.mutateAsync({
        id: tableItemForm.id,
        chargeTableId,
        name: tableItemForm.name,
        category: tableItemForm.category,
        applicationBasis: tableItemForm.applicationBasis,
        cargoProfile: tableItemForm.cargoProfile,
        currency: tableItemForm.currency,
        unitValue,
        manualOnly: tableItemForm.manualOnly,
        active: tableItemForm.active,
        sortOrder,
      })
      showToast(tableItemForm.id ? 'Item de taxa atualizado.' : 'Item de taxa criado.', 'success')
      setTableItemForm(EMPTY_TABLE_ITEM_FORM)
    } catch {
      showToast('Falha ao salvar item de taxa.', 'error')
    }
  }

  function handleEditTableItem(tableId: number, itemId: number) {
    const table = (tables ?? []).find((row) => row.id === tableId)
    const item = table?.charge_table_items.find((row) => row.id === itemId)
    if (!table || !item) return

    const unitValue = item.currency === 'USD' ? Number(item.unit_value_usd ?? 0) : Number(item.unit_value_brl ?? 0)
    setTableItemForm({
      id: item.id,
      chargeTableId: String(table.id),
      name: item.name ?? '',
      category: (item.category === 'other_charge' ? 'other_charge' : 'base') as 'base' | 'other_charge',
      applicationBasis: (item.application_basis ?? 'bl') as 'bl' | 'container_distinct_voyage' | 'weight_ton' | 'teu',
      cargoProfile: (item.cargo_profile ?? 'any') as 'standard' | 'imo' | 'oog' | 'any',
      currency: (item.currency === 'USD' ? 'USD' : 'BRL') as 'BRL' | 'USD',
      unitValue: String(unitValue),
      manualOnly: Boolean(item.manual_only),
      active: Boolean(item.active),
      sortOrder: String(Number(item.sort_order ?? 100)),
    })
  }

  async function handleDeleteTableItem(itemId: number) {
    if (!(await confirm({ message: 'Excluir este item de taxa?', tone: 'danger', confirmLabel: 'Excluir' }))) return
    try {
      await deleteChargeTableItemMutation.mutateAsync(itemId)
      showToast('Item de taxa removido.', 'success')
      if (tableItemForm.id === itemId) {
        setTableItemForm(EMPTY_TABLE_ITEM_FORM)
      }
    } catch {
      showToast('Falha ao remover item de taxa. Pode haver calculos vinculados.', 'error')
    }
  }

  function handlePrepareTableItem(tableId: number) {
    setTableItemForm({
      ...EMPTY_TABLE_ITEM_FORM,
      chargeTableId: String(tableId),
    })
  }

  return (
    <>
      <PageHeader
        title="Taxas Locais"
        description="Motor de calculo por POD/cargo mode, overrides por cliente e pendencias de revisao."
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {canManageTables ? <TabButton active={tab === 'tabelas'} label="Tabelas" onClick={() => setTab('tabelas')} /> : null}
        {canManageOverrides ? <TabButton active={tab === 'overrides'} label="Overrides" onClick={() => setTab('overrides')} /> : null}
      </div>

      {tab === 'tabelas' && canManageTables ? (
        <>
          <Card className="mb-5">
            <div className="mb-4 flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
              <div className="app-table__cell-stack">
                <div className="app-panel__title">Filtro e cobertura das tabelas</div>
                <div className="app-table__cell-meta">
                  Refine por modo e POD antes de editar estrutura tarifaria ou publicar novos itens.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="green">{tableSummary.active} ativa(s)</Badge>
                <Badge tone="blue">{tableSummary.items} item(ns)</Badge>
                <Badge tone="slate">{tableSummary.manualOnly} manual(is)</Badge>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Modo de carga">
                <Select value={cargoModeFilter} onChange={(event) => setCargoModeFilter(event.target.value as '' | 'container' | 'carga_solta' | 'granito')}>
                  <option value="">Todos</option>
                  <option value="container">Container</option>
                  <option value="carga_solta">Carga Solta</option>
                  <option value="granito">Granito</option>
                </Select>
              </Field>
              <Field label="POD">
                <Input value={podFilter} onChange={(event) => setPodFilter(event.target.value.toUpperCase())} placeholder="BRVIT / BRSSA" />
              </Field>
              <MetricCard label="Tabelas" value={String(tableSummary.tables)} />
              <MetricCard label="Itens ativos" value={String(tableSummary.items - tableSummary.manualOnly)} />
            </div>
          </Card>

          <div className="mb-5 grid gap-5 xl:grid-cols-2">
            <Card>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="app-table__cell-stack">
                  <h2 className="app-panel__title">{tableForm.id ? 'Editar tabela' : 'Nova tabela'}</h2>
                  <div className="app-table__cell-meta">Defina o escopo principal da tarifa antes de publicar itens.</div>
                </div>
                {tableForm.id ? (
                  <Button variant="ghost" type="button" onClick={() => setTableForm(EMPTY_TABLE_FORM)}>
                    <X size={15} />
                    Cancelar edição
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Nome da tabela">
                  <Input
                    value={tableForm.name}
                    onChange={(event) => setTableForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Ex: Vitoria CNTR 2026"
                  />
                </Field>
                <Field label="Modo de carga">
                  <Select
                    value={tableForm.cargoMode}
                    onChange={(event) =>
                      setTableForm((current) => ({
                        ...current,
                        cargoMode: event.target.value as 'container' | 'carga_solta' | 'granito',
                      }))
                    }
                  >
                    <option value="container">Container</option>
                    <option value="carga_solta">Carga Solta</option>
                    <option value="granito">Granito</option>
                  </Select>
                </Field>
                <Field label="POD">
                  <Input
                    value={tableForm.pod}
                    onChange={(event) =>
                      setTableForm((current) => ({
                        ...current,
                        pod: event.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="BRVIT / BRSSA"
                  />
                </Field>
                <Field label="Ativa">
                  <Select
                    value={tableForm.active ? '1' : '0'}
                    onChange={(event) =>
                      setTableForm((current) => ({
                        ...current,
                        active: event.target.value === '1',
                      }))
                    }
                  >
                    <option value="1">Sim</option>
                    <option value="0">Nao</option>
                  </Select>
                </Field>
                <Field label="Vigencia inicial">
                  <Input
                    type="date"
                    value={tableForm.validFrom}
                    onChange={(event) =>
                      setTableForm((current) => ({
                        ...current,
                        validFrom: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Vigencia final">
                  <Input
                    type="date"
                    value={tableForm.validTo}
                    onChange={(event) =>
                      setTableForm((current) => ({
                        ...current,
                        validTo: event.target.value,
                      }))
                    }
                  />
                </Field>
                <div className="md:col-span-2">
                  <Field label="Observações">
                    <Textarea
                      value={tableForm.notes}
                      onChange={(event) =>
                        setTableForm((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                      placeholder="Escopo da tabela, versão, premissas"
                    />
                  </Field>
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <Button type="button" onClick={handleSaveTable} loading={saveChargeTableMutation.isPending}>
                  <Save size={15} />
                  {tableForm.id ? 'Salvar tabela' : 'Criar tabela'}
                </Button>
              </div>
            </Card>

            <Card>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="app-table__cell-stack">
                  <h2 className="app-panel__title">{tableItemForm.id ? 'Editar item de taxa' : 'Novo item de taxa'}</h2>
                  <div className="app-table__cell-meta">Mantenha a granularidade da regra aqui, sem inflar a grade principal.</div>
                </div>
                {tableItemForm.id ? (
                  <Button variant="ghost" type="button" onClick={() => setTableItemForm(EMPTY_TABLE_ITEM_FORM)}>
                    <X size={15} />
                    Cancelar edição
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Tabela">
                  <Select
                    value={tableItemForm.chargeTableId}
                    onChange={(event) =>
                      setTableItemForm((current) => ({
                        ...current,
                        chargeTableId: event.target.value,
                      }))
                    }
                  >
                    <option value="">Selecione</option>
                    {(tables ?? []).map((table) => (
                      <option key={table.id} value={table.id}>
                        {table.cargo_mode === 'carga_solta' ? 'BB' : table.cargo_mode === 'granito' ? 'GRA' : 'CNTR'} | {table.pod ?? '-'} | {table.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Nome do item">
                  <Input
                    value={tableItemForm.name}
                    onChange={(event) =>
                      setTableItemForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    placeholder="THD / BL Fee / ISPS"
                  />
                </Field>
                <Field label="Categoria">
                  <Select
                    value={tableItemForm.category}
                    onChange={(event) =>
                      setTableItemForm((current) => ({
                        ...current,
                        category: event.target.value as 'base' | 'other_charge',
                      }))
                    }
                  >
                    <option value="base">Base</option>
                    <option value="other_charge">Other charge</option>
                  </Select>
                </Field>
                <Field label="Base de aplicacao">
                  <Select
                    value={tableItemForm.applicationBasis}
                    onChange={(event) =>
                      setTableItemForm((current) => ({
                        ...current,
                        applicationBasis: event.target.value as 'bl' | 'container_distinct_voyage' | 'weight_ton' | 'teu',
                      }))
                    }
                  >
                    <option value="bl">B/L</option>
                    <option value="container_distinct_voyage">Container distinto por viagem</option>
                    <option value="weight_ton">Tonelada</option>
                    <option value="teu">TEU</option>
                  </Select>
                </Field>
                <Field label="Perfil">
                  <Select
                    value={tableItemForm.cargoProfile}
                    onChange={(event) =>
                      setTableItemForm((current) => ({
                        ...current,
                        cargoProfile: event.target.value as 'standard' | 'imo' | 'oog' | 'any',
                      }))
                    }
                  >
                    <option value="any">Qualquer</option>
                    <option value="standard">Padrao</option>
                    <option value="imo">IMO</option>
                    <option value="oog">OOG</option>
                  </Select>
                </Field>
                <Field label="Moeda">
                  <Select
                    value={tableItemForm.currency}
                    onChange={(event) =>
                      setTableItemForm((current) => ({
                        ...current,
                        currency: event.target.value as 'BRL' | 'USD',
                      }))
                    }
                  >
                    <option value="BRL">BRL</option>
                    <option value="USD">USD</option>
                  </Select>
                </Field>
                <Field label="Valor unitario">
                  <Input
                    value={tableItemForm.unitValue}
                    onChange={(event) =>
                      setTableItemForm((current) => ({
                        ...current,
                        unitValue: event.target.value,
                      }))
                    }
                    placeholder="0.00"
                  />
                </Field>
                <Field label="Sort order">
                  <Input
                    value={tableItemForm.sortOrder}
                    onChange={(event) =>
                      setTableItemForm((current) => ({
                        ...current,
                        sortOrder: event.target.value,
                      }))
                    }
                    placeholder="100"
                  />
                </Field>
                <Field label="Manual only">
                  <Select
                    value={tableItemForm.manualOnly ? '1' : '0'}
                    onChange={(event) =>
                      setTableItemForm((current) => ({
                        ...current,
                        manualOnly: event.target.value === '1',
                      }))
                    }
                  >
                    <option value="0">Nao</option>
                    <option value="1">Sim</option>
                  </Select>
                </Field>
                <Field label="Ativo">
                  <Select
                    value={tableItemForm.active ? '1' : '0'}
                    onChange={(event) =>
                      setTableItemForm((current) => ({
                        ...current,
                        active: event.target.value === '1',
                      }))
                    }
                  >
                    <option value="1">Sim</option>
                    <option value="0">Nao</option>
                  </Select>
                </Field>
              </div>
              <div className="mt-4 flex justify-end">
                <Button type="button" onClick={handleSaveTableItem} loading={saveChargeTableItemMutation.isPending}>
                  <Save size={15} />
                  {tableItemForm.id ? 'Salvar item' : 'Criar item'}
                </Button>
              </div>
            </Card>
          </div>

          <Card className="overflow-hidden p-0">
            {tablesError ? (
              <div className="p-5 text-sm text-amber-200">
                Não foi possível consultar tabelas de taxas locais. Se você for operador, este acesso pode estar restrito por role.
              </div>
            ) : null}
            <div className="app-table-scroll">
              <table className="app-table app-table--compact min-w-[860px] text-left text-sm whitespace-nowrap">
                <thead>
                  <tr>
                    <th scope="col" className="px-4 py-3">Tabela</th>
                    <th scope="col" className="px-4 py-3">Modo</th>
                    <th scope="col" className="px-4 py-3">POD</th>
                    <th scope="col" className="px-4 py-3">Vigencia</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                    <th scope="col" className="px-4 py-3">Itens</th>
                    <th scope="col" className="px-4 py-3">Acoes</th>
                    <th scope="col" className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {tablesLoading ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-[var(--app-muted)]" colSpan={8}>
                        Carregando tabelas...
                      </td>
                    </tr>
                  ) : null}
                  {!tablesLoading && (tables?.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-0">
                        <EmptyState title="Nenhuma tabela encontrada." />
                      </td>
                    </tr>
                  ) : null}
                  {tables?.map((table) => {
                    const isExpanded = expandedTableId === table.id
                    const autoCount = table.charge_table_items?.filter((i) => !i.manual_only).length ?? 0
                    const manualCount = table.charge_table_items?.filter((i) => i.manual_only).length ?? 0
                    return (
                      <>
                        <tr key={table.id} className={isExpanded ? 'bg-[var(--app-surface-muted)]' : undefined}>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-[var(--app-text-strong)]">{table.name}</div>
                            {table.notes ? <div className="mt-0.5 text-xs text-[var(--app-muted)]">{table.notes}</div> : null}
                          </td>
                          <td className="px-4 py-3">{table.cargo_mode === 'carga_solta' ? 'Carga Solta' : table.cargo_mode === 'granito' ? 'Granito' : 'Container'}</td>
                          <td className="px-4 py-3">{table.pod ?? '-'}</td>
                          <td className="px-4 py-3">
                            {table.valid_from}{table.valid_to ? ` até ${table.valid_to}` : ' (aberta)'}
                          </td>
                          <td className="px-4 py-3">
                            <Badge tone={table.active ? 'green' : 'slate'}>{table.active ? 'Ativa' : 'Inativa'}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <Badge tone="blue">{autoCount} auto</Badge>
                              {manualCount > 0 ? <Badge tone="yellow">{manualCount} manual</Badge> : null}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button
                                className="app-table__icon-button"
                                type="button"
                                onClick={() => handleEditTable(table.id)}
                                aria-label="Editar tabela"
                                title="Editar tabela"
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                className="app-table__icon-button"
                                type="button"
                                onClick={() => handlePrepareTableItem(table.id)}
                                aria-label="Novo item nesta tabela"
                                title="Novo item nesta tabela"
                              >
                                <Plus size={13} />
                              </button>
                              <button
                                className={`app-table__icon-button ${table.active ? 'app-table__icon-button--danger' : ''}`}
                                type="button"
                                onClick={() => handleToggleTableActive(table.id, table.active)}
                                aria-label={table.active ? 'Inativar tabela' : 'Ativar tabela'}
                                title={table.active ? 'Inativar tabela' : 'Ativar tabela'}
                                disabled={setChargeTableActiveMutation.isPending}
                              >
                                {table.active ? <X size={13} /> : <Save size={13} />}
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              className="app-table__icon-button"
                              type="button"
                              onClick={() => setExpandedTableId(isExpanded ? null : table.id)}
                              title={isExpanded ? 'Recolher itens' : 'Ver itens'}
                            >
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                          </td>
                        </tr>
                        {isExpanded ? (
                          <tr key={`${table.id}-items`} className="bg-[var(--app-surface-muted)]">
                            <td colSpan={8} className="px-6 py-3">
                              {(table.charge_table_items?.length ?? 0) === 0 ? (
                                <div className="py-4 text-center text-sm text-[var(--app-muted)]">Nenhum item cadastrado nesta tabela.</div>
                              ) : (
                                <table className="w-full text-left text-sm">
                                  <thead className="text-xs uppercase tracking-wider text-[var(--app-muted)]">
                                    <tr>
                                      <th scope="col" className="py-2 pr-4">Item</th>
                                      <th scope="col" className="py-2 pr-4">Perfil</th>
                                      <th scope="col" className="py-2 pr-4">Base</th>
                                      <th scope="col" className="py-2 pr-4">Moeda</th>
                                      <th scope="col" className="py-2 pr-4 text-right">Valor</th>
                                      <th scope="col" className="py-2 pr-4">Tipo</th>
                                      <th scope="col" className="py-2"></th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {table.charge_table_items?.map((item) => (
                                      <tr key={item.id}>
                                        <td className="py-2 pr-4 font-medium text-[var(--app-text-strong)]">
                                          {item.name}
                                          {!item.active ? <span className="ml-2 text-xs text-[var(--app-muted)]">(inativo)</span> : null}
                                        </td>
                                        <td className="py-2 pr-4 text-[var(--app-muted)]">{item.cargo_profile ?? '-'}</td>
                                        <td className="py-2 pr-4 text-[var(--app-muted)]">{item.application_basis ?? '-'}</td>
                                        <td className="py-2 pr-4 text-[var(--app-muted)]">{item.currency ?? '-'}</td>
                                        <td className="py-2 pr-4 text-right font-semibold text-[var(--app-text-strong)]">
                                          {item.currency === 'USD' ? formatUSD(item.unit_value_usd ?? 0) : formatBRL(item.unit_value_brl ?? 0)}
                                        </td>
                                        <td className="py-2 pr-4">
                                          {item.manual_only ? <Badge tone="yellow">Manual</Badge> : <Badge tone="blue">Auto</Badge>}
                                        </td>
                                        <td className="py-2">
                                          <div className="flex items-center gap-1">
                                            <button
                                              className="app-table__icon-button"
                                              type="button"
                                              onClick={() => handleEditTableItem(table.id, item.id)}
                                              title="Editar item"
                                            >
                                              <Pencil size={13} />
                                            </button>
                                            <button
                                              className="app-table__icon-button app-table__icon-button--danger"
                                              type="button"
                                              onClick={() => handleDeleteTableItem(item.id)}
                                              disabled={deleteChargeTableItemMutation.isPending}
                                              title="Excluir item"
                                            >
                                              <Trash2 size={13} />
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}


      {tab === 'overrides' && canManageOverrides ? (
        <>
          <Card className="mb-5">
            <div className="mb-4 flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
              <div className="app-table__cell-stack">
                <div className="app-panel__title">Overrides por cliente</div>
                <div className="app-table__cell-meta">Sobrescreva valores pontuais sem contaminar a tabela base.</div>
              </div>
              <Badge tone="blue">{overrideRows?.length ?? 0} override(s) na visao</Badge>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Buscar cliente">
                <Input
                  value={overrideCustomerSearch}
                  onChange={(event) => setOverrideCustomerSearch(event.target.value)}
                  placeholder="Razao social ou CNPJ"
                />
              </Field>
              <Field label="Modo de carga">
                <Select value={cargoModeFilter} onChange={(event) => setCargoModeFilter(event.target.value as '' | 'container' | 'carga_solta' | 'granito')}>
                  <option value="">Todos</option>
                  <option value="container">Container</option>
                  <option value="carga_solta">Carga Solta</option>
                  <option value="granito">Granito</option>
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
              <h2 className="app-panel__title">{overrideForm.id ? 'Editar override' : 'Novo override'}</h2>
              {overrideForm.id ? (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => setOverrideForm(EMPTY_OVERRIDE_FORM)}
                >
                  <X size={15} />
                  Cancelar edição
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
              <Field label="Observações">
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
            {overridesError ? <InlineError message="Falha ao consultar overrides." /> : null}
            <div className="app-table-scroll">
              <table className="app-table app-table--compact min-w-[1220px] text-left text-sm whitespace-nowrap">
                <thead>
                  <tr>
                    <th scope="col" className="px-4 py-3">Cliente</th>
                    <th scope="col" className="px-4 py-3">Taxa</th>
                    <th scope="col" className="px-4 py-3">Modo/POD</th>
                    <th scope="col" className="px-4 py-3">Vigencia</th>
                    <th scope="col" className="px-4 py-3">Valor base</th>
                    <th scope="col" className="px-4 py-3">Override</th>
                    <th scope="col" className="px-4 py-3">Obs</th>
                    <th scope="col" className="px-4 py-3">Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {overridesLoading ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-[var(--app-muted)]" colSpan={8}>
                        Carregando overrides...
                      </td>
                    </tr>
                  ) : null}
                  {!overridesLoading && (overrideRows?.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-0">
                        <EmptyState title="Nenhum override encontrado." />
                      </td>
                    </tr>
                  ) : null}
                  {overrideRows?.map((row) => {
                    const currency = row.charge_item?.currency ?? 'BRL'
                    const baseValue =
                      currency === 'USD'
                        ? Number(row.charge_item?.unit_value_usd ?? 0)
                        : Number(row.charge_item?.unit_value_brl ?? 0)
                    const today = new Date().toISOString().slice(0, 10)
                    const validFrom = row.valid_from
                    const validTo = row.valid_to
                    const overrideStatus: 'ativa' | 'futura' | 'vencida' | 'aberta' =
                      !validFrom && !validTo
                        ? 'aberta'
                        : validTo && today > validTo
                          ? 'vencida'
                          : validFrom && today < validFrom
                            ? 'futura'
                            : 'ativa'
                    const statusStyle = {
                      ativa: 'text-emerald-400',
                      aberta: 'text-emerald-400',
                      futura: 'text-blue-400',
                      vencida: 'text-[var(--app-muted)] line-through',
                    }[overrideStatus]
                    return (
                      <tr key={row.id} className={overrideStatus === 'vencida' ? 'opacity-60' : undefined}>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-[var(--app-text-strong)]">{row.customer?.name ?? '-'}</div>
                          <div className="text-xs text-[var(--app-muted)]">{row.customer?.cnpj_cpf ?? '-'}</div>
                        </td>
                        <td className="px-4 py-3 font-semibold text-[var(--app-text-strong)]">{row.charge_item?.name ?? '-'}</td>
                        <td className="px-4 py-3">
                          {(row.charge_item?.charge_table?.cargo_mode ?? '').toUpperCase()} / {row.charge_item?.charge_table?.pod ?? '-'}
                        </td>
                        <td className="px-4 py-3">
                          <div className={`text-xs font-medium uppercase tracking-wide ${statusStyle}`}>
                            {overrideStatus}
                          </div>
                          <div className="text-xs text-[var(--app-muted)]">
                            {validFrom ?? '-'}{validTo ? ` ate ${validTo}` : validFrom ? ' (aberta)' : ''}
                          </div>
                        </td>
                        <td className="px-4 py-3">{currency === 'USD' ? formatUSD(baseValue) : formatBRL(baseValue)}</td>
                        <td className="px-4 py-3 font-semibold text-green-700">
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
    <div className="app-metric-tile">
      <div className="app-metric-tile__label">{label}</div>
      <div className="app-metric-tile__value">{value}</div>
    </div>
  )
}

function formatUSD(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0))
}
