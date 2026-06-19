import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { formatDate } from '../../lib/utils'
import { useBlTimeline } from '../../hooks/useBlTimeline'
import { describeTimelineEvent, familyLabel, familyTone, isAudited } from './blTimelinePresentation'

export function BlHistoricoTab({ active, blId }: { active: boolean; blId?: string }) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useBlTimeline(blId)
  if (!active) return null
  const events = data?.pages.flat() ?? []
  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold text-white">Histórico</h2>
      <div className="grid gap-3">
        {events.length ? null : <div className="text-sm text-slate-400">Nenhum evento registrado ainda.</div>}
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
