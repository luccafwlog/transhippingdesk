import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Boxes,
  CheckCircle,
  FileText,
  Monitor,
  Package,
  Receipt,
  ReceiptText,
  RefreshCw,
  TableProperties,
  UserX,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '../components/ui/Badge'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { LineUpTable } from '../components/lineup/LineUpTable'
import { formatBRL } from '../lib/utils'
import { fetchLineUpSnapshot } from '../services/lineup'
import { supabase } from '../services/supabase'

type FilterStatus = 'all' | 'active' | 'completed'

async function fetchDashboard() {
  const [totalContainers, bls, review, chargeReviewRequired, readyForBilling, pendingFinancial, invoices, alerts, blsWithoutCustomer] =
    await Promise.all([
      fetchDistinctContainerCount(),
      supabase.from('bls').select('id', { count: 'exact', head: true }),
      supabase.from('bls').select('id', { count: 'exact', head: true }).eq('review_status', 'pending_review'),
      supabase.from('bls').select('id', { count: 'exact', head: true }).eq('charge_status', 'review_required'),
      supabase.from('bls').select('id', { count: 'exact', head: true }).eq('charge_status', 'ready_for_billing'),
      supabase.from('bls').select('id', { count: 'exact', head: true }).eq('financial_status', 'pending'),
      supabase.from('invoices').select('total_brl,status').in('status', ['issued', 'overdue']).range(0, 499),
      supabase.from('alerts').select('id', { count: 'exact', head: true }).neq('status', 'closed'),
      supabase.from('bls').select('id', { count: 'exact', head: true }).is('customer_id', null),
    ])

  const invoiceAccessDenied = isPermissionError(invoices.error)
  const firstError = [bls, review, chargeReviewRequired, readyForBilling, pendingFinancial, alerts]
    .find((result) => result.error)?.error ?? (!invoiceAccessDenied ? invoices.error : null)
  if (firstError) throw firstError

  return {
    totalBls: bls.count ?? 0,
    totalContainers,
    pendingReview: review.count ?? 0,
    chargeReviewRequired: chargeReviewRequired.count ?? 0,
    readyForBilling: readyForBilling.count ?? 0,
    pendingFinancial: pendingFinancial.count ?? 0,
    openInvoices: invoiceAccessDenied ? null : invoices.data?.length ?? 0,
    openInvoicesAmount: invoiceAccessDenied
      ? null
      : (invoices.data?.reduce((sum, invoice) => sum + Number(invoice.total_brl ?? 0), 0) ?? 0),
    invoicesAccessDenied: invoiceAccessDenied,
    openAlerts: alerts.count ?? 0,
    blsWithoutCustomer: blsWithoutCustomer.count ?? 0,
  }
}

function isPermissionError(error: { code?: string | null; message?: string | null } | null) {
  if (!error) return false
  return error.code === '42501' || String(error.message ?? '').toLowerCase().includes('permission denied')
}

async function fetchDistinctContainerCount() {
  const { data, error } = await supabase.rpc('count_distinct_containers')
  if (error) throw error
  return Number(data ?? 0)
}

export function Painel() {
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all')
  const {
    data: dashboard,
    isLoading: isDashboardLoading,
    error: dashboardError,
  } = useQuery({ queryKey: ['dashboard'], queryFn: fetchDashboard })
  const {
    data: lineup,
    isLoading: isLineUpLoading,
    error: lineUpError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['lineup-tv-v3'],
    queryFn: fetchLineUpSnapshot,
    staleTime: 60_000,
    refetchInterval: 90_000,
  })

  const rows = useMemo(() => {
    const current = lineup?.rows ?? []
    if (statusFilter === 'all') return current
    return current.filter((row) => row.voyageStatus === statusFilter)
  }, [lineup, statusFilter])

  const lastUpdate = lineup?.lastChangedAt
    ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(
        new Date(lineup.lastChangedAt),
      )
    : '-'

  return (
    <>
      <PageHeader
        title="Painel"
        description="KPIs operacionais e quadro Line Up consolidados na pagina principal do sistema."
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

      <Card className="mb-5 mt-6">
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

      {lineUpError ? <InlineError message="Erro ao carregar o Line Up TV." /> : null}

      {isLineUpLoading ? (
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

      {dashboardError ? (
        <Card className="mb-5 mt-8 border-red-400/30 bg-red-950/30 text-sm text-red-100">
          Nao foi possivel carregar os indicadores do painel. Verifique as variaveis do Supabase e as migrations.
        </Card>
      ) : null}

      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={FileText}
          label="B/Ls ativos"
          value={isDashboardLoading ? '...' : (dashboard?.totalBls ?? 0)}
          linkTo="/manifestos"
        />
        <KpiCard
          icon={Boxes}
          label="Containers distintos"
          value={isDashboardLoading ? '...' : (dashboard?.totalContainers ?? 0)}
          linkTo="/containers"
          tone="text-[#58a6ff]"
        />
        <KpiCard
          icon={AlertTriangle}
          label="Aguardando revisao"
          value={isDashboardLoading ? '...' : (dashboard?.pendingReview ?? 0)}
          tone="text-amber-300"
          linkTo="/revisao"
        />
        <KpiCard
          icon={Receipt}
          label="Invoices em aberto"
          value={isDashboardLoading ? '...' : (dashboard?.openInvoices ?? 'Restrito')}
          detail={dashboard?.invoicesAccessDenied ? 'Admin only' : formatBRL(dashboard?.openInvoicesAmount ?? 0)}
          tone="text-emerald-300"
          linkTo="/faturamento"
        />
        <KpiCard
          icon={ReceiptText}
          label="Taxas para revisar"
          value={isDashboardLoading ? '...' : (dashboard?.chargeReviewRequired ?? 0)}
          tone="text-amber-300"
          linkTo="/taxas-locais"
        />
        <KpiCard
          icon={CheckCircle}
          label="Prontos para faturar"
          value={isDashboardLoading ? '...' : (dashboard?.readyForBilling ?? 0)}
          tone="text-emerald-300"
          linkTo="/faturamento"
        />
        <KpiCard
          icon={Receipt}
          label="B/Ls sem faturamento"
          value={isDashboardLoading ? '...' : (dashboard?.pendingFinancial ?? 0)}
          linkTo="/taxas-locais"
        />
        <KpiCard
          icon={AlertTriangle}
          label="Alertas nao fechados"
          value={isDashboardLoading ? '...' : (dashboard?.openAlerts ?? 0)}
          tone={dashboard?.openAlerts ? 'text-red-400' : undefined}
          linkTo="/alertas"
        />
        <KpiCard
          icon={UserX}
          label="B/Ls sem cliente"
          value={isDashboardLoading ? '...' : (dashboard?.blsWithoutCustomer ?? 0)}
          tone={dashboard?.blsWithoutCustomer ? 'text-red-400' : 'text-slate-400'}
          detail={dashboard?.blsWithoutCustomer ? 'Vincular em Revisao' : undefined}
          linkTo="/revisao"
        />
        <KpiCard
          icon={TableProperties}
          label="PODs sem tabela de cobranca"
          value={isDashboardLoading ? '...' : '-'}
          tone="text-slate-400"
          detail="Ver em Taxas Locais"
          linkTo="/taxas-locais"
        />
        <KpiCard
          icon={Package}
          label="Vazios Importacao (MTY)"
          value={isLineUpLoading ? '...' : (lineup?.rows ?? []).reduce((sum, r) => sum + (r.mty ?? 0), 0)}
          tone="text-slate-300"
          linkTo="/vazios-importacao"
        />
      </div>
    </>
  )
}

function KpiCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'text-[#58a6ff]',
  linkTo,
}: {
  icon: React.ComponentType<{ size?: number }>
  label: string
  value: string | number
  detail?: string
  tone?: string
  linkTo?: string
}) {
  const cardTone =
    label === 'Invoices em aberto' || label === 'Prontos para faturar'
      ? 'green'
      : label === 'Aguardando revisao' || label === 'Taxas para revisar'
        ? 'gold'
        : label === 'Containers distintos'
          ? 'blue'
          : 'navy'

  const inner = (
    <Card className={`app-kpi-card painel-kpi-card app-kpi-card--${cardTone}`}>
      <div className={`painel-kpi-card__icon ${tone}`}>
        <Icon size={24} />
      </div>
      <div className="painel-kpi-card__copy">
        <div className="app-kpi-card__label">{label}</div>
        <div className={`app-kpi-card__value app-kpi-card__value--${cardTone}`}>{value}</div>
      </div>
      <div className={`financial app-kpi-card__sub ${detail ? 'text-emerald-600' : 'painel-kpi-card__sub--empty'}`}>
        {detail ?? ''}
      </div>
    </Card>
  )

  if (linkTo) {
    return (
      <Link to={linkTo} className="block transition-opacity hover:opacity-80">
        {inner}
      </Link>
    )
  }

  return inner
}
