type PreviewBoxProps = {
  label: string
  value: number | string
  decimals?: number
  variant?: 'metric' | 'surface'
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

  return (
    <div className="app-metric-tile">
      <div className="app-metric-tile__label">{label}</div>
      <div className="app-metric-tile__value">{displayValue}</div>
    </div>
  )
}
