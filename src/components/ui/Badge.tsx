import { cn } from '../../lib/utils'

type BadgeTone = 'blue' | 'green' | 'red' | 'yellow' | 'slate'

const tones: Record<BadgeTone, string> = {
  blue: 'border-blue-400/30 bg-blue-400/10 text-blue-200',
  green: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  red: 'border-red-400/30 bg-red-400/10 text-red-200',
  yellow: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  slate: 'border-slate-400/20 bg-slate-400/10 text-slate-200',
}

export function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: BadgeTone }) {
  return (
    <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold', tones[tone])}>
      {children}
    </span>
  )
}
