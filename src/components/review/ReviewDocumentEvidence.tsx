import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { formatCnpjCpf } from '../../lib/utils'
import type { ReviewGroup } from '../../pages/revisaoHelpers'

export function ReviewDocumentEvidence({ group }: { group: ReviewGroup }) {
  const [open, setOpen] = useState<string | null>(null)
  const conflict = group.identityKind === 'conflict'

  return (
    <div className="review-evidence grid gap-2">
      <div className="review-evidence__heading">
        <span className="review-evidence__title">Evidências extraídas do B/L</span>
      </div>
      <p className="review-evidence__description">
        {conflict
          ? 'Há indícios de CNPJs diferentes. O B/L foi segregado; confirme um dos CNPJs evidenciados antes de cadastrar ou vincular o cliente.'
          : 'Confira o texto original para confirmar o CNPJ antes de criar ou vincular o cliente.'}
      </p>
      {group.candidateCnpjs.length ? (
        <div className="review-evidence__candidates">
          {group.candidateCnpjs.map((cnpj) => <Badge key={cnpj} tone="blue">{formatCnpjCpf(cnpj)}</Badge>)}
        </div>
      ) : null}
      <div className="review-evidence__items">
        {group.items.filter((item) => item.source === 'bl').map((item) => {
          const expanded = open === item.id
          return (
            <div key={item.id} className="review-evidence__item">
              <button type="button" className="review-evidence__item-toggle" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : item.id)}>
                <span><strong className="review-evidence__item-id">B/L {item.id}</strong><span className="review-evidence__item-summary">Consignatário: {item.consignee ?? 'não extraído'}</span></span>
                <ChevronDown size={16} className={`review-evidence__chevron ${expanded ? 'rotate-180' : ''}`} />
              </button>
              {expanded ? (
                <div className="review-evidence__raw-fields">
                  <div><span className="review-evidence__field-label">Campo consignatário</span><pre>{item.consignee_block || 'Não extraído'}</pre></div>
                  <div><span className="review-evidence__field-label">Descrição da carga</span><pre>{item.cargo_description || 'Não extraída'}</pre></div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
