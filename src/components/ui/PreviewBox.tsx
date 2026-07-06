type PreviewBoxProps = {
  label: string
  value: number
  variant?: 'metric' | 'surface'
}

export function PreviewBox({ label, value, variant = 'metric' }: PreviewBoxProps) {
  if (variant === 'surface') {
    return (
      <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-3">
        <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
        <div className="mt-1 text-2xl font-bold text-white">{value}</div>
      </div>
    )
  }

  return (
    <div className="app-metric-tile">
      <div className="app-metric-tile__label">{label}</div>
      <div className="app-metric-tile__value">{value}</div>
    </div>
  )
}
