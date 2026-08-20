import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { formatCnpjCpf } from '../../lib/utils'
import type { ReviewGroup } from '../../pages/revisaoHelpers'

export function ReviewDocumentEvidence({ group }: { group: ReviewGroup }) {
  const [open, setOpen] = useState<string | null>(null)
  const conflict = group.identityKind === 'conflict'

  return (
    <div className="grid gap-2 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-amber-100">Evidências extraídas do B/L</span>
        {conflict ? <Badge tone="yellow">CNPJs conflitantes</Badge> : <Badge tone="slate">CNPJ pendente</Badge>}
      </div>
      <p className="text-xs text-amber-100/80">
        {conflict
          ? 'Há indícios de CNPJs diferentes. O grupo foi segregado e nenhum vínculo em lote está disponível.'
          : 'Confira o texto original para confirmar o CNPJ antes de criar ou vincular o cliente.'}
      </p>
      {group.candidateCnpjs.length ? (
        <div className="flex flex-wrap gap-1.5">
          {group.candidateCnpjs.map((cnpj) => <Badge key={cnpj} tone="blue">{formatCnpjCpf(cnpj)}</Badge>)}
        </div>
      ) : null}
      <div className="grid gap-2">
        {group.items.filter((item) => item.source === 'bl').map((item) => {
          const expanded = open === item.id
          return (
            <div key={item.id} className="rounded border border-[#30363d] bg-[#161b22]">
              <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-slate-300" onClick={() => setOpen(expanded ? null : item.id)}>
                <span><strong className="text-white">B/L {item.id}</strong> · consignatário extraído: {item.consignee ?? '-'}</span>
                <ChevronDown size={14} className={expanded ? 'rotate-180' : ''} />
              </button>
              {expanded ? (
                <div className="grid gap-2 border-t border-[#30363d] px-3 py-2 text-xs text-slate-400">
                  <div><span className="font-medium text-slate-300">Campo consignatário:</span><pre className="mt-1 whitespace-pre-wrap break-words rounded bg-[#0d1117] p-2">{item.consignee_block || 'Não extraído'}</pre></div>
                  <div><span className="font-medium text-slate-300">Descrição da carga:</span><pre className="mt-1 whitespace-pre-wrap break-words rounded bg-[#0d1117] p-2">{item.cargo_description || 'Não extraída'}</pre></div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
