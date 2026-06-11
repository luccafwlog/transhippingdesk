import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card, EmptyState } from '../ui/Card'
import { MetricCard } from '../ui/MetricCard'
import { FilterBar } from '../ui/FilterBar'
import { Field, Input, Select, Textarea } from '../ui/Input'
import { useConfirm } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import {
  useDeleteChargeTableItem,
  useSaveChargeTable,
  useSaveChargeTableItem,
  useSetChargeTableActive,
  useLocalChargeTables,
} from '../../hooks/useLocalCharges'
import { describeActiveFilters, describeEmptyState } from '../../lib/operationalState'
import { formatBRL, formatUSD } from '../../lib/utils'
import { validateTableInput, validateTableItemInput } from '../../pages/taxasLocaisHelpers'
import {
  EMPTY_TABLE_FORM,
  EMPTY_TABLE_ITEM_FORM,
  type ChargeFilterProps,
  type ChargeTableForm,
  type ChargeTableItemForm,
} from './chargeForms'

export function ChargeTablesTab({
  cargoModeFilter,
  setCargoModeFilter,
  podFilter,
  setPodFilter,
}: ChargeFilterProps) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [expandedTableId, setExpandedTableId] = useState<number | null>(null)
  const [tableForm, setTableForm] = useState<ChargeTableForm>(EMPTY_TABLE_FORM)
  const [tableItemForm, setTableItemForm] = useState<ChargeTableItemForm>(EMPTY_TABLE_ITEM_FORM)
  const { data: tables, isLoading: tablesLoading, error: tablesError } = useLocalChargeTables({
    cargoMode: cargoModeFilter,
    pod: podFilter,
  })
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
  const tableFilterDescription = describeActiveFilters([
    { label: 'Modo', value: cargoModeFilter },
    { label: 'POD', value: podFilter },
  ])
  const tableEmptyState = describeEmptyState({
    entitySingular: 'tabela',
    entityPlural: 'tabelas',
    hasActiveFilters: Boolean(cargoModeFilter || podFilter.trim()),
    emptyWithoutFilters: 'Nenhuma tabela cadastrada ainda.',
  })

  async function handleSaveTable() {
    const result = validateTableInput(tableForm)
    if (!result.ok) {
      showToast(result.error, 'error')
      return
    }

    try {
      const savedTableId = await saveChargeTableMutation.mutateAsync({
        id: tableForm.id,
        name: tableForm.name,
        cargoMode: tableForm.cargoMode,
        pod: tableForm.pod,
        validFrom: tableForm.validFrom,
        validTo: result.value.validTo,
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
    const result = validateTableItemInput(tableItemForm)
    if (!result.ok) {
      showToast(result.error, 'error')
      return
    }
    const { chargeTableId, unitValue, sortOrder } = result.value

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
      <div className="mb-4 flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div className="app-table__cell-stack">
          <div className="app-panel__title">Cobertura das tabelas</div>
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
      <div className="mb-5 grid gap-4 md:grid-cols-2">
        <MetricCard label="Tabelas" value={String(tableSummary.tables)} />
        <MetricCard label="Itens ativos" value={String(tableSummary.items - tableSummary.manualOnly)} />
      </div>
      <FilterBar
        activeCount={(cargoModeFilter ? 1 : 0) + (podFilter.trim() ? 1 : 0)}
        onClear={() => { setCargoModeFilter(''); setPodFilter('') }}
      >
        <div className="app-filter-grid">
          <Field label="Modo de carga">
            <Select value={cargoModeFilter} onChange={(event) => setCargoModeFilter(event.target.value as ChargeFilterProps['cargoModeFilter'])}>
              <option value="">Todos</option>
              <option value="container">Container</option>
              <option value="carga_solta">Carga Solta</option>
              <option value="granito">Granito</option>
            </Select>
          </Field>
          <Field label="POD">
            <Input value={podFilter} onChange={(event) => setPodFilter(event.target.value.toUpperCase())} placeholder="BRVIT / BRSSA" />
          </Field>
        </div>
      </FilterBar>

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
        <div className="flex flex-col gap-1 border-b border-[var(--app-border)] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="font-semibold text-[var(--app-text-strong)]">{tableSummary.tables} tabela(s) retornada(s)</span>
          <span className="text-xs text-[var(--app-muted)]">{tableFilterDescription}</span>
        </div>
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
                    <EmptyState title={tableEmptyState.title} description={tableEmptyState.description} />
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
  )
}
