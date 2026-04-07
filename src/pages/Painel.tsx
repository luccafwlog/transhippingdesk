import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Boxes, FileText, Receipt } from 'lucide-react'
import { Card, PageHeader } from '../components/ui/Card'
import { supabase } from '../services/supabase'
import { formatBRL } from '../lib/utils'

async function fetchDashboard() {
  const [bls, containers, review, pendingFinancial, invoices, alerts] = await Promise.all([
    supabase.from('bls').select('id', { count: 'exact', head: true }).range(0, 0),
    supabase.from('bl_containers').select('id', { count: 'exact', head: true }).range(0, 0),
    supabase.from('bls').select('id', { count: 'exact', head: true }).eq('review_status', 'pending_review').range(0, 0),
    supabase.from('bls').select('id', { count: 'exact', head: true }).eq('financial_status', 'pending').range(0, 0),
    supabase.from('invoices').select('total_brl,status').in('status', ['issued', 'overdue']).range(0, 499),
    supabase.from('alerts').select('id', { count: 'exact', head: true }).neq('status', 'closed').range(0, 0),
  ])

  const firstError = [bls, containers, review, pendingFinancial, invoices, alerts].find((result) => result.error)?.error
  if (firstError) throw firstError

  return {
    totalBls: bls.count ?? 0,
    totalContainers: containers.count ?? 0,
    pendingReview: review.count ?? 0,
    pendingFinancial: pendingFinancial.count ?? 0,
    openInvoices: invoices.data?.length ?? 0,
    openInvoicesAmount: invoices.data?.reduce((sum, invoice) => sum + Number(invoice.total_brl ?? 0), 0) ?? 0,
    openAlerts: alerts.count ?? 0,
  }
}

export function Painel() {
  const { data, isLoading, error } = useQuery({ queryKey: ['dashboard'], queryFn: fetchDashboard })

  return (
    <>
      <PageHeader
        title="Painel executivo"
        description="KPIs operacionais carregados por consultas pontuais, sem snapshot global da base."
      />

      {error ? (
        <Card className="border-red-400/30 bg-red-950/30 text-sm text-red-100">
          Não foi possível carregar o painel. Verifique as variáveis do Supabase e as migrations.
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={FileText} label="B/Ls ativos" value={isLoading ? '...' : data?.totalBls ?? 0} />
        <KpiCard icon={Boxes} label="Containers" value={isLoading ? '...' : data?.totalContainers ?? 0} />
        <KpiCard
          icon={AlertTriangle}
          label="Aguardando revisão"
          value={isLoading ? '...' : data?.pendingReview ?? 0}
          tone="text-amber-300"
        />
        <KpiCard
          icon={Receipt}
          label="Invoices em aberto"
          value={isLoading ? '...' : data?.openInvoices ?? 0}
          detail={formatBRL(data?.openInvoicesAmount ?? 0)}
          tone="text-emerald-300"
        />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card>
          <div className="text-sm text-slate-400">B/Ls sem faturamento</div>
          <div className="mt-2 text-3xl font-bold text-white">{isLoading ? '...' : data?.pendingFinancial ?? 0}</div>
        </Card>
        <Card>
          <div className="text-sm text-slate-400">Alertas não fechados</div>
          <div className="mt-2 text-3xl font-bold text-white">{isLoading ? '...' : data?.openAlerts ?? 0}</div>
        </Card>
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
}: {
  icon: React.ComponentType<{ size?: number }>
  label: string
  value: string | number
  detail?: string
  tone?: string
}) {
  return (
    <Card>
      <div className={`${tone} mb-4`}>
        <Icon size={24} />
      </div>
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-bold text-white">{value}</div>
      {detail ? <div className="financial mt-1 text-sm text-emerald-300">{detail}</div> : null}
    </Card>
  )
}
