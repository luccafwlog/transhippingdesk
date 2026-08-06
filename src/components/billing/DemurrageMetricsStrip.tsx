import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { listDemurrageInvoices } from '../../services/demurrage/demurrageInvoices'
import { Card } from '../ui/Card'
import { MetricCard } from '../ui/MetricCard'
import { formatBRL, formatUSD } from '../../lib/utils'

// Etapa 12 do plano de faturamento: a aba Demurrage duplicava /demurrage
// (mesma lista, sem os filtros e a impressão de lá) e a própria aba já
// declarava isso em card fixo. O único recurso genuíno era o total
// consolidado em aberto, que /demurrage não mostra por segregar por status
// em abas — vira uma faixa de métricas aqui, com link para o módulo real.
export function DemurrageMetricsStrip() {
  const demurrageInvoicesQuery = useQuery({
    queryKey: ['demurrage-invoices', 'faturamento-strip'],
    queryFn: () => listDemurrageInvoices(),
    staleTime: 30_000,
  })

  const summary = useMemo(() => {
    const invoices = demurrageInvoicesQuery.data ?? []
    const open = invoices.filter((row) => row.status === 'issued' || row.status === 'overdue')
    const openBalance = open.reduce((sum, row) => sum + Number(row.current_total_brl ?? 0), 0)
    const totalUsd = invoices.reduce((sum, row) => sum + Number(row.total_usd ?? 0), 0)
    return { total: invoices.length, openCount: open.length, openBalance, totalUsd }
  }, [demurrageInvoicesQuery.data])

  return (
    <Card className="mb-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="app-panel__title">Demurrage</div>
        <Link className="app-link" to="/demurrage">Gerenciar em /demurrage →</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <MetricCard label="Faturas demurrage" value={String(summary.total)} />
        <MetricCard label="Em aberto" value={String(summary.openCount)} />
        <MetricCard label="Saldo aberto (BRL)" value={formatBRL(summary.openBalance)} />
        <MetricCard label="Total USD" value={formatUSD(summary.totalUsd)} />
      </div>
    </Card>
  )
}
