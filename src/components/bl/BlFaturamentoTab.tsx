import { Link } from 'react-router-dom'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'
import { BlClienteSection } from './BlClienteSection'
import { BlCobrancasSection } from './BlCobrancasTab'
import { BlDemurrageSection } from './BlDemurrageSection'
import { useInvoiceLinks } from '../../hooks/useBilling'
import { FINANCIAL_STATUS_LABELS } from '../../lib/statusLabels'
import type { BLDetail } from '../../types/database'

export function BlFaturamentoTab({ active, bl }: { active: boolean; bl: BLDetail }) {
  const { data: invoiceLinksByBl } = useInvoiceLinks([bl.id])
  const latestInvoice = invoiceLinksByBl?.[bl.id]?.[0] ?? null
  if (!active) return null
  return (
    <div className="grid gap-5">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="blue">
            Financeiro: {FINANCIAL_STATUS_LABELS[bl.financial_status ?? 'pending'] ?? bl.financial_status ?? 'pending'}
          </Badge>
          {latestInvoice ? (
            <Link className="text-sm font-semibold text-[#58a6ff] hover:underline" to={`/taxas-locais?invoice=${latestInvoice.id}`}>
              Fatura ativa: {latestInvoice.invoice_number ?? `INV-${latestInvoice.id}`}
            </Link>
          ) : null}
        </div>
      </Card>
      <BlClienteSection bl={bl} />
      <BlCobrancasSection bl={bl} />
      <BlDemurrageSection bl={bl} />
    </div>
  )
}
