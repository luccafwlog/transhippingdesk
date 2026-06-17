import type { ReactNode } from 'react'
import { ArrowRight, ChevronDown, type LucideIcon } from 'lucide-react'
import { tokenizeInfoValue } from '../../pages/viagensHelpers'

// Componentes apresentacionais da tela de Viagens: navegação, acordeões e métricas.

export function NavigationCard({
  icon: Icon,
  title,
  metrics,
  disabled,
  onClick,
}: {
  icon: LucideIcon
  title: string
  metrics: string[]
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`app-voyage-nav-card ${disabled ? 'app-voyage-nav-card--disabled' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] text-[var(--app-blue-btn)] shadow-sm">
          <Icon size={20} />
        </div>
        {disabled ? <span className="app-voyage-nav-card__badge">Sem dados</span> : null}
      </div>
      <div className="grid gap-2 text-left">
        <div className="text-base font-semibold text-[var(--app-text)]">{title}</div>
        <div className="grid gap-1 text-sm text-[var(--app-muted)]">
          {metrics.slice(0, 3).map((metric) => (
            <span key={`${title}-${metric}`}>{metric}</span>
          ))}
        </div>
      </div>
      <div className="mt-auto inline-flex items-center gap-2 text-sm font-semibold text-[var(--app-blue-btn)]">
        Ver
        <ArrowRight size={14} />
      </div>
    </button>
  )
}

export function AccordionSection({
  title,
  description,
  open,
  onToggle,
  children,
}: {
  title: string
  description: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const contentId = `accordion-${title.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <section className="app-voyage-accordion">
      <button
        type="button"
        className="app-voyage-accordion__trigger"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={contentId}
      >
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--app-muted)]">{title}</div>
          <div className="mt-1 text-sm text-[var(--app-muted)]">{description}</div>
        </div>
        <ChevronDown size={18} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? <div id={contentId} className="app-voyage-accordion__content">{children}</div> : null}
    </section>
  )
}

export function Info({ label, value }: { label: string; value: string }) {
  const tokens = tokenizeInfoValue(value)

  return (
    <div className={tokens.length ? 'app-voyage-info app-voyage-info--tokenized' : 'app-voyage-info'}>
      <span className="app-voyage-info__label">{label}</span>
      {tokens.length ? (
        <div className="app-voyage-token-list">
          {tokens.map((token) => (
            <span key={`${label}-${token}`} className="app-voyage-token">
              {token}
            </span>
          ))}
        </div>
      ) : (
        <span className="app-voyage-info__value">{value}</span>
      )}
    </div>
  )
}

export function MetricPanel({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="app-voyage-metric-panel">
      <div className="app-voyage-metric-panel__title">{title}</div>
      <dl className="grid gap-3 text-sm text-[var(--app-text)]">{children}</dl>
    </div>
  )
}

export function MetricSection({
  title,
  description,
  children,
  actions,
  compact,
}: {
  title: string
  description?: string
  children: ReactNode
  actions?: ReactNode
  compact?: boolean
}) {
  return (
    <section
      className={`grid rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] ${compact ? 'gap-2 p-3' : 'gap-4 p-4'}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--app-muted)]">{title}</div>
          {description ? <div className="mt-1 text-sm text-[var(--app-muted)]">{description}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}
