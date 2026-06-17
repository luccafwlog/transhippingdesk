import { FilterBar } from '../ui/FilterBar'
import { Input, Select } from '../ui/Input'
import type { ConciliacaoFilter, PeriodoFilter, StatusFilter, VoyageFilters as Filters } from '../../lib/viagensFilters'

type VoyageFiltersProps = {
  filters: Filters
  onChange: (next: Filters) => void
  onClear: () => void
  activeCount: number
  /** Total de viagens visíveis após filtro / total bruto, para o contador. */
  visibleCount: number
  totalCount: number
  loading?: boolean
}

export function VoyageFilters({
  filters,
  onChange,
  onClear,
  activeCount,
  visibleCount,
  totalCount,
  loading,
}: VoyageFiltersProps) {
  return (
    <FilterBar
      title={loading ? '—' : `${visibleCount} de ${totalCount} viagens`}
      activeCount={activeCount}
      onClear={onClear}
      defaultOpen
    >
      <div className="app-filter-grid">
        <label className="app-field">
          <span className="app-field__label">Busca</span>
          <Input
            type="search"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            placeholder="Navio, viagem, armador ou porto"
          />
        </label>

        <label className="app-field">
          <span className="app-field__label">Período</span>
          <Select
            value={filters.periodo}
            onChange={(e) => onChange({ ...filters, periodo: e.target.value as PeriodoFilter })}
          >
            <option value="all">Qualquer</option>
            <option value="hoje">Hoje</option>
            <option value="7d">Próximos 7 dias</option>
            <option value="30d">Próximos 30 dias</option>
          </Select>
        </label>

        <label className="app-field">
          <span className="app-field__label">Status</span>
          <Select
            value={filters.status}
            onChange={(e) => onChange({ ...filters, status: e.target.value as StatusFilter })}
          >
            <option value="all">Todas</option>
            <option value="active">Ativas</option>
            <option value="completed">Concluídas</option>
          </Select>
        </label>

        <label className="app-field">
          <span className="app-field__label">Conciliação</span>
          <Select
            value={filters.conciliacao}
            onChange={(e) => onChange({ ...filters, conciliacao: e.target.value as ConciliacaoFilter })}
          >
            <option value="all">Todas</option>
            <option value="conciliada">Conciliada</option>
            <option value="pendente">Pendente</option>
          </Select>
        </label>
      </div>
    </FilterBar>
  )
}
