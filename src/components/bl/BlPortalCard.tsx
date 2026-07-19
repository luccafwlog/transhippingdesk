import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import type { BlPortalNotification, BlPortalVisibility } from '../../services/blPortalStatus'

export type BlPortalStatus = { visibility: BlPortalVisibility; notifications: BlPortalNotification[]; openDisputes: Array<{ id: number; doc_number: string | null; dispute_status: string | null }> }

export function BlPortalCard({ status }: { status: BlPortalStatus }) {
  return <Card><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Cliente &amp; Portal</h3><Badge tone={status.visibility.visible ? 'green' : 'yellow'}>{status.visibility.visible ? 'Visivel no Portal' : 'Nao visivel no Portal'}</Badge></div>{status.visibility.reasons.length ? <ul className="mt-2 list-disc pl-5 text-sm text-[var(--app-muted)]">{status.visibility.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}<div className="mt-3 grid gap-2 text-sm"><strong>Notificacoes</strong>{status.notifications.length ? status.notifications.map((notification) => <div key={notification.id}>{notification.title} <span className="text-[var(--app-muted)]">({notification.read_at ? 'lida' : 'nao lida'})</span></div>) : <span className="text-[var(--app-muted)]">Nenhuma notificação do B/L.</span>}<strong>Disputas abertas</strong>{status.openDisputes.length ? status.openDisputes.map((dispute) => <div key={dispute.id}>{dispute.doc_number ?? `#${dispute.id}`} — {dispute.dispute_status ?? 'aberta'}</div>) : <span className="text-[var(--app-muted)]">Nenhuma disputa aberta.</span>}</div></Card>
}
