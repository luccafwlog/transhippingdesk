import { cn } from '../../lib/utils'

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn('rounded-2xl border border-[#30363d] bg-[#161b22]/90 p-5 shadow-2xl', className)}>{children}</section>
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
    <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div>
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-slate-400">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}
