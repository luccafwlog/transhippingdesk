import { Link } from 'react-router-dom'
import { getBlPipelineCards, type CardState, type PipelineBL } from '../../services/blStatusService'

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
  const cards = getBlPipelineCards(bl)

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
