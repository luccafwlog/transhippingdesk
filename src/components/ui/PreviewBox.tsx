import { Card } from './Card'

type PreviewBoxProps = {
  label: string
  value: number | string
  decimals?: number
  variant?: 'metric' | 'metric-centered' | 'metric-strip' | 'surface' | 'kpi'
}

export function PreviewBox({ label, value, decimals, variant = 'metric' }: PreviewBoxProps) {
  const displayValue = typeof value === 'number'
    ? value.toLocaleString('pt-BR', decimals === undefined ? undefined : {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
    : value

  if (variant === 'surface') {
    return (
      <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-3">
        <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
        <div className="mt-1 text-2xl font-bold text-white">{displayValue}</div>
      </div>
    )
  }

  if (variant === 'metric-strip') {
    return (
      <div className="app-metric-strip">
        <div className="app-metric-strip__label">{label}</div>
        <div className="app-metric-strip__value">{displayValue}</div>
      </div>
    )
  }

  if (variant === 'kpi') {
    const tone = label === 'Erros' ? 'gold' : label === 'Sucesso' ? 'green' : label === 'Processados' ? 'blue' : 'navy'

    return (
      <Card className={`app-kpi-card app-kpi-card--${tone}`}>
        <div className="app-kpi-card__label">{label}</div>
        <div className={`app-kpi-card__value app-kpi-card__value--${tone}`}>{displayValue}</div>
      </Card>
    )
  }

  return (
    <div className={`app-metric-tile${variant === 'metric-centered' ? ' text-center' : ''}`}>
      <div className="app-metric-tile__label">{label}</div>
      <div className="app-metric-tile__value">{displayValue}</div>
    </div>
  )
}
