import { Badge } from '../ui/Badge'
import { DEMURRAGE_INVOICE_STATUS_LABELS, statusLabel } from '../../lib/statusLabels'
import type { DemurrageInvoice } from '../../types/database'

export function DemurrageStatusBadge({ status }: { status: string | null }) {
  if (status === 'returned') return <Badge tone="slate">Devolvido</Badge>
  if (status === 'overdue') return <Badge tone="red">Em atraso</Badge>
  return <Badge tone="green">Free time</Badge>
}

const INVOICE_TONES: Record<string, 'green' | 'slate' | 'yellow' | 'blue'> = {
  paid: 'green',
  cancelled: 'slate',
  draft: 'yellow',
  issued: 'blue',
}

export function InvoiceStatusBadge({ status }: { status: DemurrageInvoice['status'] }) {
  return (
    <Badge tone={INVOICE_TONES[status ?? ''] ?? 'blue'}>
      {statusLabel(DEMURRAGE_INVOICE_STATUS_LABELS, status, 'Faturado')}
    </Badge>
  )
}
