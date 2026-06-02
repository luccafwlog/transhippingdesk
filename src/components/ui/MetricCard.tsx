// Cartão de métrica/KPI padrão do app (estilo "app-metric-tile"): rótulo em
// caixa alta + valor em destaque, fundo neutro, legível em tema claro e escuro.
// Unifica as 7 cópias que existiam por página.
export function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="app-metric-tile">
      <div className="app-metric-tile__label">{label}</div>
      <div className="app-metric-tile__value">{value}</div>
    </div>
  )
}
