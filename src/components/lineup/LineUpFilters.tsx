import { FilterBar } from '../ui/FilterBar'
import { Input, Select } from '../ui/Input'
import type { LineUpCeFilter, LineUpFilters as Filters, LineUpPeriodoFilter, LineUpStatusFilter } from '../../lib/lineupFilters'
import type { LineUpRow } from '../../services/lineup'

type LineUpFiltersProps = {
  rows: LineUpRow[]
  filters: Filters
  onChange: (next: Filters) => void
  onClear: () => void
  activeCount: number
  visibleCount: number
  loading?: boolean
}

export function LineUpFilters({ rows, filters, onChange, onClear, activeCount, visibleCount, loading }: LineUpFiltersProps) {
  const vessels = distinct(rows.map((row) => row.vesselName))
  const voyages = distinct(rows.map((row) => row.voyageNumber))

  return (
    <FilterBar title={loading ? '—' : `${visibleCount} escalas visíveis`} activeCount={activeCount} onClear={onClear} defaultOpen>
      <div className="app-filter-grid">
        <label className="app-field">
          <span className="app-field__label">Navios</span>
          <Select multiple value={filters.vessels} onChange={(event) => onChange({ ...filters, vessels: selectedValues(event.currentTarget) })}>
            {vessels.map((vessel) => <option key={vessel} value={vessel}>{vessel}</option>)}
          </Select>
        </label>
        <label className="app-field">
          <span className="app-field__label">Viagens</span>
          <Select multiple value={filters.voyages} onChange={(event) => onChange({ ...filters, voyages: selectedValues(event.currentTarget) })}>
            {voyages.map((voyage) => <option key={voyage} value={voyage}>{voyage}</option>)}
          </Select>
        </label>
        <label className="app-field">
          <span className="app-field__label">Status</span>
          <Select value={filters.status} onChange={(event) => onChange({ ...filters, status: event.target.value as LineUpStatusFilter })}>
            <option value="active">Escalas ativas</option>
            <option value="completed">Escalas concluídas</option>
            <option value="cancelled">Escalas canceladas</option>
            <option value="all">Todas as escalas</option>
          </Select>
        </label>
        <label className="app-field">
          <span className="app-field__label">Período</span>
          <Select value={filters.periodo} onChange={(event) => onChange({ ...filters, periodo: event.target.value as LineUpPeriodoFilter })}>
            <option value="all">Qualquer</option>
            <option value="custom">Entre datas</option>
          </Select>
        </label>
        {filters.periodo === 'custom' ? <>
          <label className="app-field"><span className="app-field__label">De</span><Input type="date" value={filters.dataInicio} onChange={(event) => onChange({ ...filters, dataInicio: event.target.value })} /></label>
          <label className="app-field"><span className="app-field__label">Até</span><Input type="date" value={filters.dataFim} onChange={(event) => onChange({ ...filters, dataFim: event.target.value })} /></label>
        </> : null}
        <label className="app-field">
          <span className="app-field__label">CEs</span>
          <Select value={filters.ces} onChange={(event) => onChange({ ...filters, ces: event.target.value as LineUpCeFilter })}>
            <option value="all">Todos</option><option value="waiting">Aguardando</option><option value="received">Recebido</option>
            <option value="launching">Lançando</option><option value="approving">Em aprovação</option><option value="approved">Aprovado</option>
          </Select>
        </label>
      </div>
      <div className="app-filter-chips" aria-label="Filtros de presença">
        <Toggle label="Possui veículos" checked={filters.vehicles} onChange={(vehicles) => onChange({ ...filters, vehicles })} />
        <Toggle label="Possui BB" checked={filters.bb} onChange={(bb) => onChange({ ...filters, bb })} />
        <Toggle label="Possui Linked" checked={filters.linked} onChange={(linked) => onChange({ ...filters, linked })} />
        <Toggle label="Possui MTY" checked={filters.mty} onChange={(mty) => onChange({ ...filters, mty })} />
        <Toggle label="Possui RTW" checked={filters.rtw} onChange={(rtw) => onChange({ ...filters, rtw })} />
      </div>
    </FilterBar>
  )
}

function Toggle({ label, checked, onChange }: { label: string, checked: boolean, onChange: (checked: boolean) => void }) {
  return <label className="app-filter-chip"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /> {label}</label>
}

function distinct(values: string[]) {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right, 'pt-BR'))
}

function selectedValues(select: HTMLSelectElement) {
  return Array.from(select.selectedOptions).map((option) => option.value)
}
