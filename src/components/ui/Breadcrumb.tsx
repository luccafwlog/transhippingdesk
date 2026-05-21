import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

export type BreadcrumbItem = {
  label: string
  to?: string
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  if (items.length <= 1) return null

  return (
    <nav aria-label="Navegação estrutural" className="app-breadcrumb">
      <ol className="app-breadcrumb__list">
        {items.map((item, index) => {
          const isLast = index === items.length - 1
          return (
            <li key={index} className="app-breadcrumb__item">
              {!isLast && item.to ? (
                <Link to={item.to} className="app-breadcrumb__link">
                  {item.label}
                </Link>
              ) : (
                <span className="app-breadcrumb__current" aria-current={isLast ? 'page' : undefined}>
                  {item.label}
                </span>
              )}
              {!isLast && (
                <ChevronRight size={13} className="app-breadcrumb__sep" aria-hidden="true" />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
