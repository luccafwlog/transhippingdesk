import { useEffect, useMemo, useState } from 'react'
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
  Ship,
  TableProperties,
  UserX,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { SkeletonTable } from '../components/ui/Skeleton'
import { LineUpTable } from '../components/lineup/LineUpTable'
import { formatBRL } from '../lib/utils'
import { fetchLineUpSnapshot } from '../services/lineup'
import { supabase } from '../services/supabase'

type FilterStatus = 'all' | 'active' | 'completed'

async function fetchDashboard() {
  const [totalContainers, bls, review, chargeReviewRequired, readyForBilling, pendingFinancial, invoices, alerts, blsWithoutCustomer, blPods, chargeTablePods] =
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
      supabase.from('bls').select('pod, cargo_mode').range(0, 1999),
      supabase.from('charge_tables').select('pod, cargo_mode').eq('active', true).range(0, 499),
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
    podsWithoutChargeTable: countPodsWithoutChargeTable(blPods.data ?? [], chargeTablePods.data ?? []),
  }
}

// PODs com B/L de container/carga solta sem nenhuma tabela de taxas ativa
// cobrindo o trecho (tabela com pod igual ou 'ANY' e mesmo cargo_mode).
function countPodsWithoutChargeTable(
  bls: { pod: string | null; cargo_mode: string | null }[],
  tables: { pod: string | null; cargo_mode: string | null }[],
) {
  const covered = new Set<string>()
  let anyContainer = false
  let anyCargaSolta = false
  for (const t of tables) {
    const mode = t.cargo_mode ?? 'container'
    const pod = (t.pod ?? '').trim().toUpperCase()
    if (!pod || pod === 'ANY') {
      if (mode === 'container') anyContainer = true
      else if (mode === 'carga_solta') anyCargaSolta = true
      continue
    }
    covered.add(`${mode}:${pod}`)
  }
  const missing = new Set<string>()
  for (const bl of bls) {
    const pod = (bl.pod ?? '').trim().toUpperCase()
    if (!pod) continue
    const mode = bl.cargo_mode ?? 'container'
    if (mode === 'container' && anyContainer) continue
    if (mode === 'carga_solta' && anyCargaSolta) continue
    if (!covered.has(`${mode}:${pod}`)) missing.add(`${mode}:${pod}`)
  }
  return missing.size
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
  // Relógio para destacar quando o quadro está sem atualização há muito tempo.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
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
  const staleMinutes = lineup?.lastChangedAt
    ? Math.floor((now - new Date(lineup.lastChangedAt).getTime()) / 60000)
    : null
  const isStale = staleMinutes !== null && staleMinutes >= 10

  return (
    <>
      <PageHeader
        title="Painel"
        description="KPIs operacionais e quadro Line Up consolidados na página principal do sistema."
        action={
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/chegadas-saidas" className="app-btn app-btn--secondary">
              <Ship size={14} />
              Chegadas e Saídas
            </Link>
            <Link to="/line-up-tv/display" target="_blank" rel="noreferrer" className="app-btn app-btn--secondary">
              <Monitor size={14} />
              Abrir tela TV
            </Link>
            <span className={isStale ? 'text-xs font-semibold text-amber-500' : 'text-xs text-slate-500'}>
              Atualizado: {lastUpdate}
              {isStale ? ` (há ${staleMinutes} min)` : ''}
            </span>
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
          
        </div>
      </Card>

      {lineUpError ? <InlineError message="Erro ao carregar o Line Up TV." /> : null}

      {isLineUpLoading ? (
        <Card className="p-0 overflow-hidden">
          <SkeletonTable rows={6} cols={8} />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <LineUpTable
            rows={rows}
            emptyTitle="Nenhuma escala encontrada."
            emptyDescription="Ajuste o filtro de status ou aguarde o proximo ciclo de atualizacao."
          />
          <p className="border-t border-[var(--app-border)] px-4 py-2 text-[11px] text-[var(--app-muted)]">
            VIN = veículos · VIN CNTR = containers com veículos · CG = carga geral · MTY = vazios · RTW = restow ·
            BB = break-bulk (máquinas/pacotes) · CEs = status dos CEs Mercante · Linked = manifesto vinculado
          </p>
        </Card>
      )}

      {dashboardError ? (
        <Card className="mb-5 mt-8 border-red-400/30 bg-red-950/30 text-sm text-red-100">
          Não foi possível carregar os indicadores do painel. Verifique as variáveis do Supabase e as migrations.
        </Card>
      ) : null}

      <div className="mt-8 grid gap-4 grid-cols-[repeat(auto-fit,minmax(210px,1fr))]">
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
          label="Faturas em aberto"
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
          label="Alertas não fechados"
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
          value={isDashboardLoading ? '...' : (dashboard?.podsWithoutChargeTable ?? 0)}
          tone={dashboard?.podsWithoutChargeTable ? 'text-red-400' : 'text-slate-400'}
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
    label === 'Faturas em aberto' || label === 'Prontos para faturar'
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
