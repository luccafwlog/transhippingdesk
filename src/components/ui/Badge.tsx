import { cn } from '../../lib/utils'

type BadgeTone = 'blue' | 'green' | 'red' | 'yellow' | 'slate'

const tones: Record<BadgeTone, string> = {
  blue: 'app-badge--blue',
  green: 'app-badge--green',
  red: 'app-badge--red',
  yellow: 'app-badge--yellow',
  slate: 'app-badge--slate',
}

export function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: BadgeTone }) {
  return <span className={cn('app-badge', tones[tone])}>{children}</span>
}
