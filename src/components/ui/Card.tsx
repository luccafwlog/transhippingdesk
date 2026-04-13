import { cn } from '../../lib/utils'

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  const hasPaddingOverride = /\bp(?:[trblxy])?-[^\s]+/.test(className ?? '')

  return <section className={cn('app-surface', !hasPaddingOverride && 'app-surface--padded', className)}>{children}</section>
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
