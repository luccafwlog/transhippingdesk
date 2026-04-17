import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Monitor, RefreshCw } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { LineUpTable } from '../components/lineup/LineUpTable'
import { fetchLineUpSnapshot, type VoyageStatus } from '../services/lineup'

type FilterStatus = 'all' | 'active' | 'completed'

export function LineUpTV() {
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all')

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['lineup-tv-v3'],
    queryFn: fetchLineUpSnapshot,
    staleTime: 60_000,
    refetchInterval: 90_000,
  })

  const rows = useMemo(() => {
    const current = data?.rows ?? []
    if (statusFilter === 'all') return current
    return current.filter((row) => row.voyageStatus === statusFilter)
  }, [data, statusFilter])

  const summary = useMemo(() => {
    return {
      routes: rows.length,
      totalContainers: rows.reduce((sum, row) => sum + row.total, 0),
      vehicles: rows.reduce((sum, row) => sum + row.vin, 0),
      approvedCe: rows.filter((row) => row.ceStatus === 'approved').length,
    }
  }, [rows])

  const lastUpdate = data?.lastChangedAt
    ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(
        new Date(data.lastChangedAt),
      )
    : '-'

  return (
    <>
      <PageHeader
        title="Line up TV"
        description="Quadro consolidado por viagem e POD com foco na operacao atual do porto de descarga."
        action={
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/line-up-tv/display" target="_blank" rel="noreferrer" className="app-btn app-btn--secondary">
              <Monitor size={14} />
              Abrir tela TV
            </Link>
            <span className="text-xs text-slate-500">Atualizado: {lastUpdate}</span>
            <button type="button" onClick={() => void refetch()} className="app-btn app-btn--secondary">
              <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
              Atualizar
            </button>
          </div>
        }
      />

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <LineUpMetricCard label="Rotas exibidas" value={String(summary.routes)} tone="navy" />
        <LineUpMetricCard label="CNTRs no quadro" value={String(summary.totalContainers)} tone="blue" />
        <LineUpMetricCard label="Veiculos" value={String(summary.vehicles)} tone="green" />
        <LineUpMetricCard label="CEs approved" value={String(summary.approvedCe)} tone="gold" />
      </div>

      <Card className="mb-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {(['all', 'active', 'completed'] as FilterStatus[]).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setStatusFilter(filter)}
                className={`app-tab ${statusFilter === filter ? 'app-tab--active' : ''}`}
              >
                {filter === 'all' ? 'Todas as escalas' : filter === 'active' ? 'Escalas ativas' : 'Escalas concluidas'}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="blue">ETB vinculado ao cadastro manual do POD</Badge>
            <Badge tone="green">ATD remove a rota do quadro</Badge>
            <Badge tone="slate">Tela TV: /line-up-tv/display</Badge>
          </div>
        </div>
      </Card>

      {error ? <InlineError message="Erro ao carregar o Line Up TV." /> : null}

      {isLoading ? (
        <div className="py-16 text-center text-slate-400">Carregando line up...</div>
      ) : (
        <Card className="overflow-hidden p-0">
          <LineUpTable
            rows={rows}
            emptyTitle="Nenhuma escala encontrada."
            emptyDescription="Ajuste o filtro de status ou aguarde o proximo ciclo de atualizacao."
          />
        </Card>
      )}
    </>
  )
}

function LineUpMetricCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'navy' | 'blue' | 'green' | 'gold'
}) {
  return (
    <Card className={`app-kpi-card app-kpi-card--${tone}`}>
      <div className="app-kpi-card__label">{label}</div>
      <div className={`app-kpi-card__value app-kpi-card__value--${tone}`}>{value}</div>
    </Card>
  )
}

export type { VoyageStatus }
