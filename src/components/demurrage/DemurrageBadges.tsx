import { Badge } from '../ui/Badge'
import type { DemurrageInvoice } from '../../types/database'

export function DemurrageStatusBadge({ status }: { status: string | null }) {
  if (status === 'returned') return <Badge tone="slate">Devolvido</Badge>
  if (status === 'overdue') return <Badge tone="red">Em atraso</Badge>
  return <Badge tone="green">Free time</Badge>
}

export function InvoiceStatusBadge({ status }: { status: DemurrageInvoice['status'] }) {
  if (status === 'paid') return <Badge tone="green">Pago</Badge>
  if (status === 'cancelled') return <Badge tone="slate">Cancelado</Badge>
  return <Badge tone="blue">Faturado</Badge>
}
