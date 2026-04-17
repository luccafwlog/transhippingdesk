import { QRCodeSVG } from 'qrcode.react'
import type { DemurrageInvoiceDetail } from '../../types/database'

type Props = {
  detail: DemurrageInvoiceDetail
  type: 'invoice' | 'receipt'
}

function fmtBRL(v: number) {
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtUSD(v: number) {
  return '$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(`${s}T12:00:00`).toLocaleDateString('pt-BR')
}

function fmtCNPJ(s: string | null | undefined) {
  if (!s) return ''
  const d = s.replace(/\D/g, '')
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return s
}

function longDate() {
  return new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

export function InvoiceDocument({ detail, type }: Props) {
  const { items, customer, bl, ...invoice } = detail
  const isInvoice = type === 'invoice'

  const vessel = bl?.voyage?.vessel?.name ?? '—'
  const voyageNumber = bl?.voyage?.voyage_number ?? '—'

  const roe = invoice.frozen_roe ?? invoice.roe ?? null
  const rawTotal = items.reduce((s, i) => s + i.subtotal_usd, 0)
  let discountAmt = 0
  if (invoice.discount_value && invoice.discount_value > 0 && roe) {
    if (invoice.discount_mode === 'percent') {
      discountAmt = rawTotal * roe * (invoice.discount_value / 100)
    } else {
      discountAmt = invoice.discount_value
    }
  }
  const totalBRL = invoice.frozen_total_brl ?? (roe ? Math.max(0, rawTotal * roe - discountAmt) : 0)
  const hasDiscount = invoice.discount_value && invoice.discount_value > 0

  return (
    <div className="invoice" style={{ fontFamily: 'Arial, sans-serif', fontSize: '13px', color: '#111' }}>
      {/* Header */}
      <div className="inv-header">
        <div className="inv-logo-area">
          <img src="/branding/tr-logo.png" alt="Transhipping" style={{ height: 48 }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: '15px', color: '#1A2744' }}>TRANSHIPPING</div>
            <div style={{ fontSize: '11px', color: '#666' }}>Agenciamento Marítimo</div>
          </div>
        </div>
        <div className="inv-num" style={{ fontSize: '14px', fontWeight: 600, color: '#1A2744' }}>
          Nº {invoice.doc_number}
        </div>
      </div>

      <div className="inv-title" style={{ textAlign: 'center', fontSize: '17px', fontWeight: 700, textTransform: 'uppercase', margin: '12px 0 4px' }}>
        {isInvoice ? 'FATURA DE SOBREESTADIA DE CONTAINER' : 'RECIBO DE QUITAÇÃO DE SOBREESTADIA'}
      </div>
      <hr style={{ borderTop: '2px solid #1A2744', margin: '8px 0 16px' }} />

      {/* Client info */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        <span style={{ fontWeight: 600, minWidth: 110 }}>Cliente:</span>
        <span>{customer?.name ?? '—'}{customer?.cnpj_cpf ? <><br />CNPJ: {fmtCNPJ(customer.cnpj_cpf)}</> : ''}</span>
      </div>
      <hr style={{ borderTop: '1px solid #ddd', margin: '10px 0' }} />

      {/* Shipping details */}
      {[
        ['BL', invoice.bl_id],
        ['Navio / Viagem', `${vessel} / ${voyageNumber}`],
        ['POL', bl?.pol ?? '—'],
        ['POD', bl?.pod ?? '—'],
      ].map(([label, value]) => (
        <div key={label} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <span style={{ fontWeight: 600, minWidth: 110 }}>{label}:</span>
          <span>{value}</span>
        </div>
      ))}

      {/* ROE */}
      {roe && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <div style={{ background: '#F59E0B', padding: '6px 16px', display: 'flex', gap: 12, fontWeight: 600, borderRadius: 4 }}>
            <span>ROE</span>
            <span>R$ {roe.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</span>
          </div>
        </div>
      )}

      {/* Items table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', margin: '16px 0', fontSize: '12px' }}>
        <thead>
          <tr style={{ background: '#1A2744', color: 'white' }}>
            <th style={{ padding: '9px 7px', textAlign: 'left' }}>Container</th>
            <th style={{ padding: '9px 7px' }}>Tipo</th>
            <th style={{ padding: '9px 7px' }}>Dias 1º Per.</th>
            <th style={{ padding: '9px 7px' }}>USD/Dia P1</th>
            <th style={{ padding: '9px 7px' }}>Dias 2º Per.</th>
            <th style={{ padding: '9px 7px' }}>USD/Dia P2</th>
            <th style={{ padding: '9px 7px' }}>Descarga</th>
            <th style={{ padding: '9px 7px' }}>Retorno</th>
            <th style={{ padding: '9px 7px', textAlign: 'right' }}>Líquido USD</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={item.id} style={{ background: idx % 2 === 0 ? '#f9fafb' : 'white', borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '8px 7px', fontWeight: 600 }}>{item.container_number}</td>
              <td style={{ padding: '8px 7px', textAlign: 'center' }}>{item.container_type}</td>
              <td style={{ padding: '8px 7px', textAlign: 'center' }}>{item.days_p1}</td>
              <td style={{ padding: '8px 7px', textAlign: 'center' }}>{fmtUSD(item.rate_p1_usd)}</td>
              <td style={{ padding: '8px 7px', textAlign: 'center' }}>{item.days_p2}</td>
              <td style={{ padding: '8px 7px', textAlign: 'center' }}>{fmtUSD(item.rate_p2_usd)}</td>
              <td style={{ padding: '8px 7px', textAlign: 'center' }}>{fmtDate(item.discharge_date)}</td>
              <td style={{ padding: '8px 7px', textAlign: 'center' }}>{fmtDate(item.return_date)}</td>
              <td style={{ padding: '8px 7px', textAlign: 'right', fontWeight: 600 }}>{fmtUSD(item.subtotal_usd)}</td>
            </tr>
          ))}

          {hasDiscount && (
            <>
              <tr>
                <td colSpan={8} style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, background: '#F59E0B' }}>SUBTOTAL:</td>
                <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, background: '#F59E0B' }}>{fmtBRL(totalBRL + discountAmt)}</td>
              </tr>
              <tr style={{ background: '#f0fdf4' }}>
                <td colSpan={8} style={{ padding: '8px 12px' }}>
                  DESCONTO {invoice.discount_mode === 'percent' ? `(${invoice.discount_value}%)` : 'FIXO'}
                  {invoice.discount_type ? ` — ${invoice.discount_type}` : ''}:
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: '#166534' }}>- {fmtBRL(discountAmt)}</td>
              </tr>
            </>
          )}

          <tr style={{ background: '#F59E0B' }}>
            <td colSpan={8} style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700 }}>
              {hasDiscount ? 'TOTAL FINAL:' : 'TOTAL:'}
            </td>
            <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700 }}>{fmtBRL(totalBRL)}</td>
          </tr>

          {isInvoice && invoice.due_date && (
            <tr style={{ background: '#1A2744', color: 'white' }}>
              <td colSpan={8} style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600 }}>VENCIMENTO:</td>
              <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600 }}>{fmtDate(invoice.due_date)}</td>
            </tr>
          )}

          {!isInvoice && invoice.paid_at && (
            <tr style={{ background: '#166534', color: 'white' }}>
              <td colSpan={8} style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600 }}>DATA DE PAGAMENTO:</td>
              <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600 }}>{fmtDate(invoice.paid_at)}</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Bank details */}
      <div style={{ marginTop: 20, fontSize: '12.5px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <strong>Detalhes Bancários</strong>
          <div style={{ marginTop: 6, lineHeight: 1.7 }}>
            TRANSHIPPING AGENCIAMENTO MARITIMO Ltda.<br />
            CNPJ 06.352.972/0001-21<br />
            BANCO: ITAU<br />
            AGÊNCIA: 0870 - PRAIA DO CANTO<br />
            CONTA CORRENTE 37293-5
          </div>
        </div>
        <div style={{ background: '#F59E0B', fontWeight: 700, padding: '6px 14px', fontSize: '15px', borderRadius: 4 }}>
          {fmtBRL(totalBRL)}
        </div>
      </div>

      {/* PIX section — invoice only */}
      {isInvoice && invoice.pix_payload && (
        <div style={{ display: 'flex', gap: 18, marginTop: 20, paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
          <div style={{ flexShrink: 0 }}>
            <QRCodeSVG value={invoice.pix_payload} size={100} level="M" />
          </div>
          <div style={{ flex: 1, fontSize: '12px', color: '#333', lineHeight: 1.6 }}>
            <strong>Pagamento via PIX</strong><br />
            Escaneie o QR Code ou use o Pix Copia e Cola:<br />
            <span style={{ display: 'block', fontFamily: 'monospace', fontSize: '8.5px', background: '#f3f4f6', padding: '5px 8px', borderRadius: 4, marginTop: 6, wordBreak: 'break-all' }}>
              {invoice.pix_payload}
            </span>
          </div>
        </div>
      )}

      {/* Receipt PAGO stamp */}
      {!isInvoice && (
        <div style={{ textAlign: 'center', margin: '20px 0', fontSize: '32px', fontWeight: 900, color: '#166534', border: '4px solid #166534', borderRadius: 8, padding: '8px 0', letterSpacing: 8 }}>
          PAGO
        </div>
      )}

      {/* Footer date */}
      <div style={{ marginTop: 24, textAlign: 'right', fontSize: '12px', color: '#555' }}>
        Vitória, {longDate()}
      </div>
    </div>
  )
}
