import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { DollarSign, Container, AlertTriangle, FileText } from 'lucide-react'
import { Card, PageHeader } from '../components/ui/Card'
import { MetricCard } from '../components/ui/MetricCard'
import { Badge } from '../components/ui/Badge'
import { usePortalAuth } from '../hooks/usePortalAuth'
import { usePortalInvoices, usePortalConsolidatableReceivables } from '../hooks/usePortalBilling'
import { usePortalOperationBls } from '../hooks/usePortalOperation'
import { formatBRL } from '../lib/utils'

const OVERDUE_STATUSES = ['overdue']
const DUE_SOON_DAYS = 7

function isDueSoon(dateStr: string | null): boolean {
  if (!dateStr) return false
  const dueDate = new Date(dateStr)
  const today = new Date()
  const diff = dueDate.getTime() - today.getTime()
  return diff > 0 && diff <= DUE_SOON_DAYS * 86400000
}

export function PortalDashboard() {
  const { overview } = usePortalAuth()
  const { data: invoices, isLoading: invLoading } = usePortalInvoices()
  const { data: receivables } = usePortalConsolidatableReceivables()
  const { data: operationBls, isLoading: opLoading } = usePortalOperationBls()

  const eligibleCount = (receivables ?? []).filter((r) => r.eligibility_status === 'eligible').length
  const totalBls = operationBls?.length ?? 0
  const totalContainers = useMemo(
    () => (operationBls ?? []).reduce((sum, row) => sum + row.container_count, 0),
    [operationBls],
  )
  const containersInDemurrage = useMemo(
    () => (operationBls ?? []).reduce((sum, row) => sum + row.containers_in_demurrage, 0),
    [operationBls],
  )

  const nav = useNavigate()

  const alerts = useMemo(() => {
    const result: { type: 'warning' | 'danger' | 'info'; message: string; link?: string }[] = []
    const overdueFaturas = (invoices ?? []).filter((i) => OVERDUE_STATUSES.includes(i.status ?? ''))
    if (overdueFaturas.length > 0) {
      result.push({
        type: 'danger',
        message: `${overdueFaturas.length} fatura(s) vencida(s). Regularize para evitar restricoes.`,
        link: '/portal/billing',
      })
    }

    const dueSoon = (invoices ?? []).filter((i) => isDueSoon(i.due_date))
    if (dueSoon.length > 0) {
      result.push({
        type: 'warning',
        message: `${dueSoon.length} fatura(s) vence(m) nos proximos ${DUE_SOON_DAYS} dias.`,
        link: '/portal/billing',
      })
    }

    if (containersInDemurrage > 0) {
      result.push({
        type: 'warning',
        message: `${containersInDemurrage} container(es) em regime de demurrage.`,
        link: '/portal/operacao',
      })
    }

    if (eligibleCount > 0) {
      result.push({
        type: 'info',
        message: `${eligibleCount} B/L(s) elegiveis para consolidacao de fatura.`,
        link: '/portal/billing',
      })
    }

    return result
  }, [invoices, containersInDemurrage, eligibleCount])

  const loading = invLoading || opLoading

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Bem-vindo, ${overview?.customer_name ?? 'Cliente'}`}
      />

      {loading ? (
        <div className="mb-5 text-sm text-[var(--app-muted)]">Carregando indicadores...</div>
      ) : (
        <>
          <div className="mb-5 grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
            <MetricCard
              label="Saldo pendente"
              value={formatBRL(overview?.pending_balance)}
              icon={<DollarSign size={18} />}
            />
            <MetricCard
              label="Faturas emitidas"
              value={String(invoices?.length ?? 0)}
              icon={<FileText size={18} />}
            />
            <MetricCard
              label="B/Ls em aberto"
              value={String(totalBls)}
              icon={<Container size={18} />}
            />
            <MetricCard
              label="Containers"
              value={String(totalContainers)}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {alerts.length > 0 ? (
              <Card className="p-4">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <AlertTriangle size={16} />
                  Alertas
                </h2>
                <div className="grid gap-2">
                  {alerts.map((alert, i) => (
                    <div
                      key={i}
                      className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                        alert.type === 'danger'
                          ? 'border-[var(--app-red)]/30 bg-[var(--app-red)]/5 text-[var(--app-red)]'
                          : alert.type === 'warning'
                            ? 'border-[var(--app-yellow)]/30 bg-[var(--app-yellow)]/5 text-[var(--app-yellow)]'
                            : 'border-[var(--app-blue)]/30 bg-[var(--app-blue)]/5 text-[var(--app-blue)]'
                      }`}
                    >
                      <span className="mt-0.5 shrink-0">
                        {alert.type === 'danger' ? '🔴' : alert.type === 'warning' ? '🟡' : '🔵'}
                      </span>
                      <div className="flex-1">
                        <p>{alert.message}</p>
                        {alert.link ? (
                          <button
                            type="button"
                            className="mt-1 font-medium underline hover:no-underline"
                            onClick={() => nav(alert.link!)}
                          >
                            Ver detalhes
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ) : (
              <Card className="p-4">
                <h2 className="mb-2 text-sm font-semibold">Situacao</h2>
                <p className="text-sm text-[var(--app-muted)]">Nenhum alerta pendente no momento.</p>
              </Card>
            )}

            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold">Indicadores operacionais</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs uppercase tracking-wider text-[var(--app-muted)]">B/Ls</div>
                  <div className="text-xl font-semibold">{totalBls}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-[var(--app-muted)]">Containers</div>
                  <div className="text-xl font-semibold">{totalContainers}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-[var(--app-muted)]">Em demurrage</div>
                  <div className="text-xl font-semibold">
                    <Badge tone={containersInDemurrage > 0 ? 'red' : 'green'}>
                      {containersInDemurrage}
                    </Badge>
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-[var(--app-muted)]">B/Ls elegiveis</div>
                  <div className="text-xl font-semibold">{eligibleCount}</div>
                </div>
              </div>
            </Card>
          </div>
        </>
      )}
    </>
  )
}
