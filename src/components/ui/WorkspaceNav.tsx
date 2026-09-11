import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ComponentType } from 'react'

export type WorkspaceNavItem = {
  to: string
  label: string
  description: string
  icon: ComponentType<{ size?: number | string; 'aria-hidden'?: boolean }>
  /** Contagem pendente do destino; omitida quando ainda não carregou. */
  count?: number | null
  countLabel?: string
}

type WorkspaceNavProps = {
  items: WorkspaceNavItem[]
  /** Rótulo do grupo, lido por leitores de tela. */
  ariaLabel: string
}

// Faixa de navegação para outros ambientes gerenciais (Provisionamento do
// Portal, Comunicação, ...). Todos os destinos têm a mesma natureza — sair da
// tela atual para outro contexto de trabalho —, então recebem o mesmo peso
// visual. Ações que operam SOBRE a tela atual continuam no PageHeader.
export function WorkspaceNav({ items, ariaLabel }: WorkspaceNavProps) {
  if (!items.length) return null

  return (
    <nav aria-label={ariaLabel} className="app-workspace-nav">
      {items.map(({ to, label, description, icon: Icon, count, countLabel }) => (
        <Link key={to} to={to} className="app-workspace-nav__item">
          <span className="app-workspace-nav__icon" aria-hidden="true">
            <Icon size={18} />
          </span>
          <span className="app-workspace-nav__body">
            <span className="app-workspace-nav__label">
              {label}
              {typeof count === 'number' ? (
                <span className="app-workspace-nav__count" aria-label={countLabel ?? `${count} pendente(s)`}>
                  {count}
                </span>
              ) : null}
            </span>
            <span className="app-workspace-nav__description">{description}</span>
          </span>
          <ArrowRight size={16} className="app-workspace-nav__arrow" aria-hidden="true" />
        </Link>
      ))}
    </nav>
  )
}
