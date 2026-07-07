import { Printer, RotateCcw } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { MetricCard } from '../ui/MetricCard'
import { Modal } from '../ui/Modal'
import { portalInvoiceStatusLabel } from '../../lib/portalInvoiceStatus'
import { formatBRL, stripBlPrefix } from '../../lib/utils'
import type { PortalInvoiceDetail } from '../../services/portalBilling'
import { PortalPixPaymentBlock } from './PortalPixPaymentBlock'

type PortalInvoiceDetailModalProps = {
  open: boolean
  invoiceId: number | null
  detail: PortalInvoiceDetail | undefined
  loading: boolean
  error: unknown
  canObsolete: boolean
  obsoleteLoading: boolean
  onClose: () => void
  onObsolete: () => void
  onPrint: () => void
}

export function PortalInvoiceDetailModal({
  open,
  invoiceId,
  detail,
  loading,
  error,
  canObsolete,
  obsoleteLoading,
  onClose,
  onObsolete,
  onPrint,
}: PortalInvoiceDetailModalProps) {
  const invoice = detail?.invoice

  return (
    <Modal open={open} onClose={onClose} title={`Fatura ${invoice?.invoice_number ?? invoiceId ?? ''}`}>
      <div className="grid gap-5">
        {loading ? <div className="text-sm text-[var(--app-muted)]">Carregando detalhe...</div> : null}
        {error ? <div className="text-sm text-[var(--app-red)]">Falha ao carregar detalhe da fatura.</div> : null}
        {invoice ? (
          <>
            <div className="flex flex-wrap justify-end gap-2">
              {canObsolete ? (
                <Button variant="ghost" loading={obsoleteLoading} onClick={onObsolete}>
                  <RotateCcw size={16} />
                  Refazer consolidada
                </Button>
              ) : null}
              <Button variant="secondary" onClick={onPrint}>
                <Printer size={16} />
                Imprimir PDF
              </Button>
            </div>
            <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
              <MetricCard label="Status" value={portalInvoiceStatusLabel(invoice.status)} />
              <MetricCard label="Total" value={formatBRL(invoice.total_brl)} />
              <MetricCard label="Pago" value={formatBRL(invoice.total_paid_brl)} />
              <MetricCard label="Saldo" value={formatBRL(invoice.balance_brl)} />
              <MetricCard label="B/Ls" value={String(detail?.bls.length ?? 0)} />
            </div>

            <DetailSection title="B/Ls" subtitle="Conhecimentos de embarque desta fatura">
              <table className="app-table app-table--compact min-w-[620px] text-left text-sm">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">B/L</th>
                    <th scope="col" className="px-3 py-2">Navio/Viagem</th>
                    <th scope="col" className="px-3 py-2">Trecho</th>
                    <th scope="col" className="px-3 py-2">Subtotal BRL</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail?.bls ?? []).map((row) => (
                    <tr key={row.id}>
                      <td className="px-3 py-2 font-semibold">{row.bl_id}</td>
                      <td className="px-3 py-2">{[row.vessel_name, row.voyage_number].filter(Boolean).join(' / ') || '-'}</td>
                      <td className="px-3 py-2">{row.pol ?? '-'} - {row.pod ?? '-'}</td>
                      <td className="px-3 py-2">{formatBRL(row.subtotal_brl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DetailSection>

            {(detail?.items?.length ?? 0) > 0 ? (
              <DetailSection title="Itens cobrados" subtitle="Taxas, quantidades e valores">
                <table className="app-table app-table--compact min-w-[680px] text-left text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className="px-3 py-2">Descricao</th>
                      <th scope="col" className="px-3 py-2">B/L</th>
                      <th scope="col" className="px-3 py-2 text-right">Qtd</th>
                      <th scope="col" className="px-3 py-2 text-right">Valor unit.</th>
                      <th scope="col" className="px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail?.items ?? []).map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2">{stripBlPrefix(item.description, item.bl_id)}</td>
                        <td className="px-3 py-2">{item.bl_id ?? '-'}</td>
                        <td className="px-3 py-2 text-right">{item.quantity ?? '-'}</td>
                        <td className="px-3 py-2 text-right">{item.unit_value_brl != null ? formatBRL(item.unit_value_brl) : '-'}</td>
                        <td className="px-3 py-2 text-right font-semibold">{formatBRL(item.total_value_brl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DetailSection>
            ) : null}

            {(detail?.containers?.length ?? 0) > 0 ? (
              <DetailSection title="Containers" subtitle="Equipamentos vinculados aos B/Ls">
                <table className="app-table app-table--compact min-w-[620px] text-left text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className="px-3 py-2">Container</th>
                      <th scope="col" className="px-3 py-2">Tipo</th>
                      <th scope="col" className="px-3 py-2">B/L</th>
                      <th scope="col" className="px-3 py-2">Lacre</th>
                      <th scope="col" className="px-3 py-2 text-right">Peso bruto (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail?.containers ?? []).map((cont) => (
                      <tr key={cont.id}>
                        <td className="px-3 py-2 font-semibold">{cont.container_number}</td>
                        <td className="px-3 py-2">{cont.type ?? '-'}</td>
                        <td className="px-3 py-2">{cont.bl_id ?? '-'}</td>
                        <td className="px-3 py-2">{cont.seal_number ?? '-'}</td>
                        <td className="px-3 py-2 text-right">{cont.gross_weight_kg != null ? cont.gross_weight_kg.toLocaleString('pt-BR') : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DetailSection>
            ) : null}

            {invoice.pix_payload ? <PortalPixPaymentBlock pixPayload={invoice.pix_payload} /> : null}
          </>
        ) : null}
      </div>
    </Modal>
  )
}

function DetailSection({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-[var(--app-border)] px-4 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-xs text-[var(--app-muted)]">{subtitle}</p> : null}
      </div>
      <div className="app-table-scroll">{children}</div>
    </Card>
  )
}
