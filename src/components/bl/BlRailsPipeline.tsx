import { Link } from 'react-router-dom'
import type { DocumentalSummary, RailStage, RailState } from '../../services/blRails'

const stateDot: Record<RailState, string> = { done: 'bg-emerald-500', pending: 'bg-amber-400', blocked: 'bg-red-500', diverted: 'bg-sky-400' }
const stateLabel: Record<RailState, string> = { done: 'Concluído', pending: 'Pendente', blocked: 'Bloqueado', diverted: 'Desviado' }

function Stage({ stage }: { stage: RailStage }) {
  const inner = (
    <div
      className="flex min-w-[9rem] flex-col gap-1 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2"
      aria-label={`${stage.label}: ${stateLabel[stage.state]}. ${stage.detail}`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${stateDot[stage.state]}`} aria-hidden="true" />
        <span className="text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">{stage.label}</span>
      </div>
      <span className="text-sm font-semibold text-[var(--app-text-strong)]">{stage.detail}</span>
    </div>
  )
  return stage.href ? <Link to={stage.href} className="hover:opacity-80">{inner}</Link> : inner
}

function Rail({ title, stages, summary }: { title: string; stages: RailStage[]; summary?: DocumentalSummary }) {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--app-muted)]">{title}</span>
        {summary ? <span className="text-xs font-medium text-[var(--app-muted)]" aria-label={`Pendências documentais: ${summary.label}`}>· {summary.label}</span> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {stages.map((stage, index) => (
          <div key={stage.key} className="flex items-center gap-2">
            {index > 0 ? <span className="hidden sm:inline text-[var(--app-muted)]">→</span> : null}
            <Stage stage={stage} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function BlRailsPipeline({ operational, documental, documentalSummary, nextAction }: { operational: RailStage[]; documental: RailStage[]; documentalSummary: DocumentalSummary; nextAction: RailStage | null }) {
  return (
    <div className="grid gap-4 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4">
      {nextAction ? (
        <Link to={nextAction.href ?? '#'} className="flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 hover:opacity-90">
          <span className="text-xs font-semibold uppercase tracking-wider text-amber-300">Próxima ação</span>
          <span className="text-sm font-semibold text-[var(--app-text-strong)]">{nextAction.label}: {nextAction.detail}</span>
        </Link>
      ) : null}
      <Rail title="Operacional" stages={operational} />
      <Rail title="Documental" stages={documental} summary={documentalSummary} />
    </div>
  )
}
