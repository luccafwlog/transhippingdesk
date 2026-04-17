import type { LucideIcon } from 'lucide-react'
import { AlertCircle, Inbox } from 'lucide-react'
import { cn } from '../../lib/utils'

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  const hasPaddingOverride = /\bp(?:[trblxy])?-[^\s]+/.test(className ?? '')

  return <section className={cn('app-surface', !hasPaddingOverride && 'app-surface--padded', className)}>{children}</section>
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
}: {
  icon?: LucideIcon
  title: string
  description?: string
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-14 text-center">
      <Icon size={36} className="text-slate-600" strokeWidth={1.5} />
      <p className="text-sm font-medium text-slate-400">{title}</p>
      {description ? <p className="text-xs text-slate-500">{description}</p> : null}
    </div>
  )
}

export function InlineError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-red-900/40 bg-red-900/20 px-4 py-3 text-sm text-red-200">
      <AlertCircle size={15} className="shrink-0" />
      {message}
    </div>
  )
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="page-header">
      <div className="page-header__copy">
        <h1 className="page-header__title">{title}</h1>
        {description ? <p className="page-header__description">{description}</p> : null}
      </div>
      {action ? <div className="page-header__actions">{action}</div> : null}
    </div>
  )
}
