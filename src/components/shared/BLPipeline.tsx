import { Link } from 'react-router-dom'
import type { BL } from '../../types/database'

type PipelineBL = Pick<
  BL,
  | 'review_status'
  | 'customer_reconciliation_status'
  | 'charge_status'
  | 'financial_status'
>

type CardState = 'green' | 'yellow' | 'red'

type PipelineCard = {
  label: string
  detail: string
  state: CardState
  href?: string
}

function reviewCard(bl: PipelineBL): PipelineCard {
  const s = bl.review_status
  if (s === 'reviewed') return { label: 'Revisao', detail: 'Revisado', state: 'green' }
  if (s === 'ok') return { label: 'Revisao', detail: 'OK', state: 'green' }
  return { label: 'Revisao', detail: 'Pendente', state: 'red', href: '/revisao' }
}

function customerCard(bl: PipelineBL): PipelineCard {
  const s = bl.customer_reconciliation_status
  if (s === 'reconciled') return { label: 'Cliente', detail: 'Reconciliado', state: 'green' }
  if (s === 'matched_document' || s === 'matched_name') return { label: 'Cliente', detail: 'Aguardando confirmar', state: 'yellow' }
  if (s === 'missing_customer') return { label: 'Cliente', detail: 'Não identificado', state: 'red', href: '/clientes' }
  if (s === 'rejected') return { label: 'Cliente', detail: 'Rejeitado', state: 'red', href: '/clientes' }
  return { label: 'Cliente', detail: 'Pendente', state: 'yellow' }
}

function chargesCard(bl: PipelineBL): PipelineCard {
  const s = bl.charge_status
  if (s === 'ready_for_billing' || s === 'exempt') return { label: 'Taxas', detail: 'Pronto p/ faturar', state: 'green' }
  if (s === 'reviewed') return { label: 'Taxas', detail: 'Revisado', state: 'yellow' }
  if (s === 'calculated' || s === 'review_required') return { label: 'Taxas', detail: 'Calculado', state: 'yellow' }
  return { label: 'Taxas', detail: 'Não calculado', state: 'red', href: '/taxas-locais' }
}

function financialCard(bl: PipelineBL): PipelineCard {
  const s = bl.financial_status
  if (s === 'paid') return { label: 'Financeiro', detail: 'Pago', state: 'green' }
  if (s === 'invoiced') return { label: 'Financeiro', detail: 'Faturado', state: 'yellow', href: '/faturamento' }
  if (s === 'cancelled') return { label: 'Financeiro', detail: 'Cancelado', state: 'red' }
  return { label: 'Financeiro', detail: 'Pendente', state: 'yellow', href: '/faturamento' }
}

const stateStyles: Record<CardState, { border: string; bg: string; dot: string; label: string; detail: string }> = {
  green: {
    border: 'border-emerald-500/30',
    bg: 'bg-emerald-500/5',
    dot: 'bg-emerald-500',
    label: 'text-slate-400',
    detail: 'text-emerald-400',
  },
  yellow: {
    border: 'border-amber-400/30',
    bg: 'bg-amber-400/5',
    dot: 'bg-amber-400',
    label: 'text-slate-400',
    detail: 'text-amber-300',
  },
  red: {
    border: 'border-red-500/30',
    bg: 'bg-red-500/5',
    dot: 'bg-red-500',
    label: 'text-slate-400',
    detail: 'text-red-400',
  },
}

export function BLPipeline({ bl }: { bl: PipelineBL }) {
  const cards = [reviewCard(bl), customerCard(bl), chargesCard(bl), financialCard(bl)]

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {cards.map((card) => {
        const styles = stateStyles[card.state]
        const inner = (
          <div className={`rounded-xl border ${styles.border} ${styles.bg} px-4 py-3 transition-colors`}>
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 flex-shrink-0 rounded-full ${styles.dot}`} aria-hidden="true" />
              <span className={`text-xs font-medium uppercase tracking-wider ${styles.label}`}>{card.label}</span>
            </div>
            <div className={`mt-1 text-sm font-semibold ${styles.detail}`}>{card.detail}</div>
            {card.href ? <div className="mt-1 text-xs text-slate-500">Ver →</div> : null}
          </div>
        )

        if (card.href) {
          return (
            <Link key={card.label} to={card.href} className="block hover:opacity-80">
              {inner}
            </Link>
          )
        }
        return <div key={card.label}>{inner}</div>
      })}
    </div>
  )
}
