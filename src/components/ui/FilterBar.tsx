import { useState, type ReactNode } from 'react'
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react'
import { cn } from '../../lib/utils'

type FilterBarProps = {
  /** Conteúdo dos filtros — normalmente um `<div className="app-filter-grid">`. */
  children: ReactNode
  /** Quantidade de filtros ativos; exibida como contador e mantém a barra aberta. */
  activeCount?: number
  /** Chamado ao clicar em "Limpar"; o botão só aparece quando há filtros ativos. */
  onClear?: () => void
  /** Rótulo do cabeçalho. */
  title?: string
  /** Estado inicial. Por padrão abre quando há filtros ativos. */
  defaultOpen?: boolean
}

// Barra de filtros recolhível e reutilizável. Mantém o estado de aberto/fechado
// localmente e exibe um contador de filtros ativos + ação de limpar.
export function FilterBar({
  children,
  activeCount = 0,
  onClear,
  title = 'Filtros',
  defaultOpen,
}: FilterBarProps) {
  const [open, setOpen] = useState(defaultOpen ?? activeCount > 0)

  return (
    <div className={cn('app-filter-bar', open && 'app-filter-bar--open')}>
      <div className="app-filter-bar__head">
        <button
          type="button"
          className="app-filter-bar__toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <SlidersHorizontal size={16} className="shrink-0" />
          <span>{title}</span>
          {activeCount > 0 ? <span className="app-filter-bar__count">{activeCount}</span> : null}
          <ChevronDown size={16} className="app-filter-bar__chevron" aria-hidden="true" />
        </button>
        {activeCount > 0 && onClear ? (
          <button type="button" className="app-btn app-btn--ghost app-btn--sm app-filter-bar__clear" onClick={onClear}>
            <X size={14} />
            Limpar
          </button>
        ) : null}
      </div>
      {open ? <div className="app-filter-bar__body">{children}</div> : null}
    </div>
  )
}
