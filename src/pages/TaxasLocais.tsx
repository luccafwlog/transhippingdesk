import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calculator, RefreshCw } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { Field, Input, Select } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { useBlLocalChargeLines, useCalculateBlLocalCharges, useChargePendencies, useLocalChargeTables } from '../hooks/useLocalCharges'
import { formatBRL } from '../lib/utils'

type LocalChargeTab = 'tabelas' | 'pendencias' | 'simulacao'

export function TaxasLocais() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [tab, setTab] = useState<LocalChargeTab>('tabelas')
  const [cargoModeFilter, setCargoModeFilter] = useState<'' | 'container' | 'carga_solta'>('')
  const [podFilter, setPodFilter] = useState('')
  const [simulationBlIdInput, setSimulationBlIdInput] = useState('')
  const [simulationBlId, setSimulationBlId] = useState('')
  const { data: tables, isLoading: tablesLoading, error: tablesError } = useLocalChargeTables({
    cargoMode: cargoModeFilter,
    pod: podFilter,
  })
  const { data: pendencies, isLoading: pendenciesLoading, error: pendenciesError } = useChargePendencies(200)
  const { data: simulationLines, isLoading: simulationLinesLoading } = useBlLocalChargeLines(simulationBlId)
  const calculateMutation = useCalculateBlLocalCharges(simulationBlId)

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
    } catch {
      showToast('Falha ao calcular taxas para o B/L informado.', 'error')
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

      {tab === 'simulacao' ? (
        <>
          <Card className="mb-5">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
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
              <MetricCard label="Subtotal BRL" value={formatBRL(simulationTotals.brl)} />
              <MetricCard label="Subtotal USD" value={formatUSD(simulationTotals.usd)} />
              <MetricCard label="Linhas" value={String(simulationLines?.length ?? 0)} />
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
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363d]">
                  {simulationLinesLoading ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-slate-400" colSpan={8}>
                        Carregando simulacao...
                      </td>
                    </tr>
                  ) : null}
                  {!simulationLinesLoading && (simulationLines?.length ?? 0) === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-slate-400" colSpan={8}>
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

