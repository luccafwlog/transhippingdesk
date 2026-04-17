import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Boxes, FileText, Receipt, ReceiptText, CheckCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card, PageHeader } from '../components/ui/Card'
import { normalizeContainerNumber } from '../lib/containerCounts'
import { supabase } from '../services/supabase'
import { formatBRL } from '../lib/utils'

async function fetchDashboard() {
  const [totalContainers, bls, review, chargeReviewRequired, readyForBilling, pendingFinancial, invoices, alerts] =
    await Promise.all([
      fetchDistinctContainerCount(),
      supabase.from('bls').select('id', { count: 'exact', head: true }),
      supabase.from('bls').select('id', { count: 'exact', head: true }).eq('review_status', 'pending_review'),
      supabase.from('bls').select('id', { count: 'exact', head: true }).eq('charge_status', 'review_required'),
      supabase.from('bls').select('id', { count: 'exact', head: true }).eq('charge_status', 'ready_for_billing'),
      supabase.from('bls').select('id', { count: 'exact', head: true }).eq('financial_status', 'pending'),
      supabase.from('invoices').select('total_brl,status').in('status', ['issued', 'overdue']).range(0, 499),
      supabase.from('alerts').select('id', { count: 'exact', head: true }).neq('status', 'closed'),
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
  }
}

function isPermissionError(error: { code?: string | null; message?: string | null } | null) {
  if (!error) return false
  return error.code === '42501' || String(error.message ?? '').toLowerCase().includes('permission denied')
}

async function fetchDistinctContainerCount() {
  const containerNumbers = new Set<string>()
  let from = 0
  const batchSize = 1000

  while (true) {
    const { data, error } = await supabase
      .from('bl_containers')
      .select('container_number')
      .order('id', { ascending: true })
      .range(from, from + batchSize - 1)

    if (error) throw error

    const batch = data ?? []
    for (const row of batch) {
      const containerNumber = normalizeContainerNumber(row.container_number)
      if (containerNumber) {
        containerNumbers.add(containerNumber)
      }
    }

    if (batch.length < batchSize) break
    from += batchSize
  }

  return containerNumbers.size
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
        <KpiCard
          icon={FileText}
          label="B/Ls ativos"
          value={isLoading ? '...' : (data?.totalBls ?? 0)}
          linkTo="/manifestos"
        />
        <KpiCard
          icon={Boxes}
          label="Containers distintos"
          value={isLoading ? '...' : (data?.totalContainers ?? 0)}
          linkTo="/containers"
          tone="text-[#58a6ff]"
        />
        <KpiCard
          icon={AlertTriangle}
          label="Aguardando revisão"
          value={isLoading ? '...' : (data?.pendingReview ?? 0)}
          tone="text-amber-300"
          linkTo="/revisao"
        />
        <KpiCard
          icon={Receipt}
          label="Invoices em aberto"
          value={isLoading ? '...' : (data?.openInvoices ?? 'Restrito')}
          detail={data?.invoicesAccessDenied ? 'Admin only' : formatBRL(data?.openInvoicesAmount ?? 0)}
          tone="text-emerald-300"
          linkTo="/faturamento"
        />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={ReceiptText}
          label="Taxas para revisar"
          value={isLoading ? '...' : (data?.chargeReviewRequired ?? 0)}
          tone="text-amber-300"
          linkTo="/taxas-locais"
        />
        <KpiCard
          icon={CheckCircle}
          label="Prontos para faturar"
          value={isLoading ? '...' : (data?.readyForBilling ?? 0)}
          tone="text-emerald-300"
          linkTo="/faturamento"
        />
        <KpiCard
          icon={Receipt}
          label="B/Ls sem faturamento"
          value={isLoading ? '...' : (data?.pendingFinancial ?? 0)}
          linkTo="/taxas-locais"
        />
        <KpiCard
          icon={AlertTriangle}
          label="Alertas não fechados"
          value={isLoading ? '...' : (data?.openAlerts ?? 0)}
          tone={data?.openAlerts ? 'text-red-400' : undefined}
          linkTo="/alertas"
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
      : label === 'Aguardando revisão' || label === 'Taxas para revisar'
        ? 'gold'
        : label === 'Containers distintos'
          ? 'blue'
          : 'navy'

  const inner = (
    <Card className={`app-kpi-card app-kpi-card--${cardTone}`}>
      <div className={`${tone} mb-4`}>
        <Icon size={24} />
      </div>
      <div className="app-kpi-card__label">{label}</div>
      <div className={`app-kpi-card__value app-kpi-card__value--${cardTone}`}>{value}</div>
      {detail ? <div className="financial app-kpi-card__sub text-emerald-600">{detail}</div> : null}
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
