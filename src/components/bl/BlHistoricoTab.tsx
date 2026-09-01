import { Link } from 'react-router-dom'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { formatDate } from '../../lib/utils'
import { useBlTimeline } from '../../hooks/useBlTimeline'
import { describeTimelineEvent, familyLabel, familyTone, isAudited } from './blTimelinePresentation'
import { useBlCommunicationHistory } from '../../hooks/useCustomerCommunications'
import { customerCommunicationKindLabel, customerCommunicationStatusLabel } from '../../services/customerCommunications'

export function BlHistoricoTab({ active, blId }: { active: boolean; blId?: string }) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useBlTimeline(blId)
  const { data: communications } = useBlCommunicationHistory(blId)
  if (!active) return null
  const events = data?.pages.flat() ?? []
  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold text-white">Histórico</h2>
      <div className="grid gap-3">
        {events.length || communications?.length ? null : <div className="text-sm text-slate-400">Nenhum evento registrado ainda.</div>}
        {events.map((event) => (
          <div key={`${event.entity_type}-${event.id}`} className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-sm">
            <div className="mb-1 flex items-center gap-2">
              <Badge tone={familyTone(event.family)}>{familyLabel(event.family)}</Badge>
              {isAudited(event) ? <Badge tone="green">Auditoria</Badge> : null}
            </div>
            <div className="font-semibold text-white">{describeTimelineEvent(event)}</div>
            <div className="mt-1 text-slate-400">
              {event.changed_at ? formatDate(event.changed_at) : '-'} {event.justification ? `| ${event.justification}` : ''}
            </div>
          </div>
        ))}
        {communications?.map((communication) => (
          <div key={`communication-${communication.id}`} className="rounded-xl border border-cyan-400/30 bg-cyan-400/5 p-3 text-sm">
            <div className="mb-1 flex items-center gap-2">
              <Badge tone="blue">Comunicado</Badge>
              <Badge tone={communication.status === 'enviado' ? 'green' : communication.status === 'falha' ? 'red' : 'yellow'}>
                {customerCommunicationStatusLabel(communication.status)}
              </Badge>
            </div>
            <div className="font-semibold text-white">{customerCommunicationKindLabel(communication.kind)}</div>
            <div className="mt-1 text-slate-400">
              {new Date(communication.created_at).toLocaleString('pt-BR')}
              {communication.anchor_port ? ` · ${communication.anchor_port}` : ''}
              {communication.attachments.length ? ` · ${communication.attachments.length} anexo(s)` : ''}
              {' · '}
              <Link to={`/clientes/comunicacao?tab=historico&communication=${encodeURIComponent(String(communication.id))}`} className="text-cyan-200 hover:text-cyan-100">Abrir histórico</Link>
            </div>
          </div>
        ))}
      </div>
      {hasNextPage ? (
        <div className="mt-4">
          <Button type="button" variant="secondary" loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>
            Carregar mais
          </Button>
        </div>
      ) : null}
    </Card>
  )
}
