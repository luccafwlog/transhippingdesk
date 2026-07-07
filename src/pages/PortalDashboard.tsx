import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { ShipScheduleWidget } from '../components/portal/ShipScheduleWidget'
import { usePortalInvoices, usePortalDemurrageInvoices } from '../hooks/usePortalBilling'
import { usePortalOperationBls } from '../hooks/usePortalOperation'
import { countContainersInDemurrage, countContainersWithoutReturn } from '../lib/portalOperationViews'
import { formatBRL } from '../lib/utils'
import { CLOSED_DEMURRAGE_STATUSES, OPEN_INVOICE_STATUSES } from '../lib/portalInvoiceStatus'

type PanelCard = {
  label: string
  primary: string
  secondary: string
  link: string
}

export function PortalDashboard() {
  const { data: invoices, isLoading: invLoading, error: invoicesError } = usePortalInvoices()
  const { data: demurrage, isLoading: demLoading, error: demurrageError } = usePortalDemurrageInvoices()
  const { data: operationBls, isLoading: opLoading, error: operationError } = usePortalOperationBls()
  const nav = useNavigate()

  const cards = useMemo<PanelCard[]>(() => {
    const openLocal = (invoices ?? []).filter((i) => (OPEN_INVOICE_STATUSES as readonly string[]).includes(i.status ?? 'issued'))
    const localTotal = openLocal.reduce((sum, i) => sum + (i.balance_brl ?? 0), 0)

    const openDemurrage = (demurrage ?? []).filter((i) => !(CLOSED_DEMURRAGE_STATUSES as readonly string[]).includes(i.status ?? 'issued'))
    const demurrageTotal = openDemurrage.reduce((sum, i) => sum + (i.current_total_brl ?? 0), 0)

    const containersNoReturn = countContainersWithoutReturn(operationBls ?? [])
    const containersDemurrage = countContainersInDemurrage(operationBls ?? [])

    return [
      {
        label: 'Taxas locais em aberto',
        primary: formatBRL(localTotal),
        secondary: `${openLocal.length} fatura(s) em aberto`,
        link: '/portal/billing?tab=local',
      },
      {
        label: 'Demurrage em aberto',
        primary: formatBRL(demurrageTotal),
        secondary: `${openDemurrage.length} fatura(s) em aberto`,
        link: '/portal/billing?tab=demurrage',
      },
      {
        label: 'Containers sem devolucao',
        primary: String(containersNoReturn),
        secondary: 'container(es) ainda nao devolvido(s)',
        link: '/portal/operacao?tab=containers&devolucao=sem_devolucao',
      },
      {
        label: 'Containers em demurrage',
        primary: String(containersDemurrage),
        secondary: 'container(es) gerando sobreestadia',
        link: '/portal/operacao?tab=containers&devolucao=em_demurrage',
      },
    ]
  }, [invoices, demurrage, operationBls])

  const loading = invLoading || demLoading || opLoading
  const financialError = Boolean(invoicesError || demurrageError)
  const operationLoadError = Boolean(operationError)

  return (
    <>
      <PageHeader title="Painel" />

      {loading ? (
        <div className="text-sm text-[var(--app-muted)]">Carregando indicadores...</div>
      ) : financialError ? (
        <InlineError message="Falha ao carregar indicadores financeiros. Tente novamente em instantes." />
      ) : operationLoadError ? (
        <InlineError message="Falha ao carregar indicadores operacionais. Tente novamente em instantes." />
      ) : (
        <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
          {cards.map((card) => (
            <Card key={card.label} className="p-0">
              <button
                type="button"
                onClick={() => nav(card.link)}
                className="flex w-full flex-col gap-1 rounded-2xl p-5 text-left hover:bg-[var(--app-surface-hover)]"
              >
                <span className="text-xs uppercase tracking-wider text-[var(--app-muted)]">{card.label}</span>
                <span className="text-2xl font-semibold">{card.primary}</span>
                <span className="text-sm text-[var(--app-muted)]">{card.secondary}</span>
              </button>
            </Card>
          ))}
        </div>
      )}

      <section className="mt-8">
        <h2 className="text-base font-semibold mb-4">Chegadas e Saídas</h2>
        <ShipScheduleWidget />
      </section>
    </>
  )
}
