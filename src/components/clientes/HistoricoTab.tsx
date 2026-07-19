import { Link } from 'react-router-dom'
import { Card } from '../ui/Card'
import { useCustomerTimeline } from '../../hooks/useCustomerFicha'
import { formatDate } from '../../lib/utils'
import type { useCustomerDetail } from '../../hooks/useCustomers'

export function HistoricoTab({ data }: { data: NonNullable<ReturnType<typeof useCustomerDetail>['data']> }) {
  const { data: timeline, isLoading } = useCustomerTimeline(data.id, data.customer_contacts ?? [], data.bls ?? [])

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold text-white">Histórico do Cliente</h2>
      {isLoading ? <div className="text-sm text-slate-400">Carregando...</div> : null}
      {!isLoading && !timeline?.length ? <div className="text-sm text-slate-400">Sem eventos registrados.</div> : null}
      <ol className="grid gap-3 text-sm">
        {timeline?.map((event) => (
          <li key={`${event.kind}-${event.sourceId}`}>
            <span className="mr-3 text-xs text-slate-500">{formatDate(event.at)}</span>
            {event.link ? <Link to={event.link}>{event.label}</Link> : event.label}
            {event.detail ? <span className="ml-2 text-xs text-slate-400">{event.detail}</span> : null}
          </li>
        ))}
      </ol>
    </Card>
  )
}
