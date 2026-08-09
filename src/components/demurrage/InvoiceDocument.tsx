import { QRCodeSVG } from 'qrcode.react'
import { COMPANY } from '../../config/company'
import type { DemurrageInvoiceDetail } from '../../types/database'
import { cell, documentRoot, fmtBRL, fmtCNPJ, labelCell } from '../shared/invoiceFormat'
import { InvoiceDocFooter, InvoiceDocHeader, InvoiceDocTitle } from '../shared/InvoiceDocumentKit'

type Props = { detail: DemurrageInvoiceDetail; type: 'invoice' | 'receipt' }

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(`${s}T12:00:00`).toLocaleDateString('pt-BR')
}

export function InvoiceDocument({ detail, type }: Props) {
  const { items, customer, bl, ...invoice } = detail
  const customerAddress = customer as typeof customer & { address?: string | null; city?: string | null; state?: string | null; zip?: string | null }
  const isInvoice = type === 'invoice'
  const roe = invoice.current_roe ?? invoice.roe ?? null
  const roeValue = roe ?? 1
  const vesselVoyage = `${bl?.voyage?.vessel?.name ?? ''} ${bl?.voyage?.voyage_number ?? ''}`.trim() || '—'
  const containers = items.map((item) => item.container_number).join(', ') || '—'
  const itemsWithBRL = items.map((item) => ({ ...item, subtotal_brl: item.subtotal_usd * roeValue }))
  const rawTotalBRL = itemsWithBRL.reduce((sum, item) => sum + item.subtotal_brl, 0)

  let discountBRL = 0
  if (invoice.discount_value && invoice.discount_value > 0) {
    discountBRL = invoice.discount_mode === 'percent'
      ? rawTotalBRL * (invoice.discount_value / 100)
      : invoice.discount_value * roeValue
  }
  const totalBRL = invoice.current_total_brl ?? Math.max(0, rawTotalBRL - discountBRL)
  const hasDiscount = (invoice.discount_value ?? 0) > 0

  return (
    <div style={documentRoot}>
      <InvoiceDocHeader logoSrc="/branding/transhipping-logo-cropped.png" docNumber={invoice.doc_number} />
      <InvoiceDocTitle uppercase>
        {isInvoice ? 'FATURA DE SOBREESTADIA DE CONTAINER' : 'RECIBO DE QUITAÇÃO DE SOBREESTADIA'}
      </InvoiceDocTitle>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
        <tbody>
          <tr><td style={labelCell}>Cliente:</td><td style={{ ...cell, fontSize: 13 }}>{customer?.name ?? '—'}{customerAddress?.address ? <><br />{customerAddress.address}</> : ''}{customerAddress?.city || customerAddress?.state || customerAddress?.zip ? <><br />{[customerAddress.city, customerAddress.state].filter(Boolean).join(' - ')}{customerAddress.zip ? ` CEP ${customerAddress.zip}` : ''}</> : ''}{customer?.cnpj_cpf ? <><br />CNPJ: {fmtCNPJ(customer.cnpj_cpf)}</> : ''}</td></tr>
        </tbody>
      </table>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
        <tbody>
          <tr><td style={labelCell}>BL</td><td style={{ ...cell, color: '#1A2744', fontWeight: 600 }}>{invoice.bl_id}</td></tr>
          <tr><td style={labelCell}>Container(s)</td><td style={cell}>{containers}</td></tr>
          <tr><td style={labelCell}>Navio/Voy:</td><td style={cell}>{vesselVoyage}</td></tr>
          <tr><td style={labelCell}>From:</td><td style={cell}>{bl?.pol ?? '—'}</td></tr>
          <tr><td style={labelCell}>To:</td><td style={cell}>{bl?.pod ?? '—'}</td></tr>
        </tbody>
      </table>

      {roe != null && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}><div style={{ background: '#F59E0B', padding: '5px 18px', display: 'flex', justifyContent: 'space-between', gap: 60, minWidth: 125, fontWeight: 700, borderRadius: 2, fontSize: 13 }}><span>ROE</span><span>{roe.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</span></div></div>}

      <table style={{ width: '100%', borderCollapse: 'collapse', margin: '16px 0 0', fontSize: '12px' }}>
        <thead><tr style={{ background: '#1A2744', color: 'white' }}>
          {['CONTAINER', 'TIPO', 'DIAS 1º PER.', 'USD/Dia', 'DIAS 2º PER.', 'USD/Dia', 'DESCARGA', 'RETORNO', 'LÍQUIDO'].map((header) => <th scope="col" key={header} style={{ padding: '9px 7px', textAlign: header === 'CONTAINER' ? 'left' : 'center', fontWeight: 600 }}>{header}</th>)}
        </tr></thead>
        <tbody>
          {itemsWithBRL.map((item, idx) => (
            <tr key={item.id} style={{ background: idx % 2 === 0 ? '#f9fafb' : 'white', borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '8px 7px', fontWeight: 600 }}>{item.container_number}</td><td style={{ padding: '8px 7px', textAlign: 'center' }}>{item.container_type}</td><td style={{ padding: '8px 7px', textAlign: 'center' }}>{item.days_p1}</td><td style={{ padding: '8px 7px', textAlign: 'center' }}>{item.rate_p1_usd.toFixed(2)}</td><td style={{ padding: '8px 7px', textAlign: 'center' }}>{item.days_p2}</td><td style={{ padding: '8px 7px', textAlign: 'center' }}>{item.rate_p2_usd.toFixed(2)}</td><td style={{ padding: '8px 7px', textAlign: 'center' }}>{fmtDate(item.discharge_date)}</td><td style={{ padding: '8px 7px', textAlign: 'center' }}>{fmtDate(item.return_date)}</td><td style={{ padding: '8px 7px', textAlign: 'right', fontWeight: 600 }}>{fmtBRL(item.subtotal_brl)}</td>
            </tr>
          ))}
          {hasDiscount && <>
            <tr style={{ background: '#f0f4fa' }}><td colSpan={8} style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 600 }}>Subtotal:</td><td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 600 }}>{fmtBRL(rawTotalBRL)}</td></tr>
            <tr style={{ background: '#f0fdf4' }}><td colSpan={8} style={{ padding: '7px 12px', textAlign: 'right' }}>Desconto {invoice.discount_mode === 'percent' ? `(${invoice.discount_value}%)` : 'fixo'}{invoice.discount_type ? ` — ${invoice.discount_type}` : ''}:</td><td style={{ padding: '7px 12px', textAlign: 'right', color: '#166534' }}>- {fmtBRL(discountBRL)}</td></tr>
          </>}
          <tr style={{ background: '#F59E0B' }}><td colSpan={8} style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700 }}>TOTAL:</td><td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700 }}>{fmtBRL(totalBRL)}</td></tr>
          {isInvoice && invoice.due_date && <tr style={{ background: '#1A2744', color: 'white' }}><td colSpan={8} style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600 }}>VENCIMENTO DIA</td><td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600 }}>{fmtDate(invoice.due_date)}</td></tr>}
          {!isInvoice && invoice.paid_at && <tr style={{ background: '#166534', color: 'white' }}><td colSpan={8} style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600 }}>DATA DE PAGAMENTO:</td><td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600 }}>{fmtDate(invoice.paid_at)}</td></tr>}
        </tbody>
      </table>

      {/* ── PIX section ── */}
      {isInvoice && invoice.pix_payload && (
        <div style={{ display: 'flex', gap: 18, marginTop: 20, paddingTop: 16, borderTop: '1px solid #e5e7eb', alignItems: 'flex-start' }}>
          <div style={{ flexShrink: 0 }}>
            <QRCodeSVG aria-label="QR Code Pix" value={invoice.pix_payload} size={90} level="M" />
          </div>
          <div style={{ flex: 1, fontSize: '12px', color: '#333', lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: 4 }}>PAGAMENTO VIA PIX</div>
            <div>Escaneie o QR Code ao lado ou utilize o código Pix Copia e Cola abaixo para realizar o pagamento.</div>
            <div style={{ marginTop: 4 }}>Valor da fatura:</div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{fmtBRL(totalBRL)}</div>
            <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 3 }}>PIX COPIA E COLA</div>
            <span style={{ display: 'block', fontFamily: 'monospace', fontSize: '8px', background: '#f3f4f6', padding: '5px 8px', borderRadius: 3, wordBreak: 'break-all', color: '#374151' }}>
              {invoice.pix_payload}
            </span>
          </div>
        </div>
      )}

      <div style={{ borderTop: '1px solid #e5e7eb', marginTop: 30, paddingTop: 14, fontSize: 13, lineHeight: 1.45 }}><strong>Recebedor:</strong><div style={{ display: 'inline-block', verticalAlign: 'top', marginLeft: 80 }}>{COMPANY.name.toUpperCase()}<br />CNPJ: {COMPANY.cnpj}</div></div>

      {/* ── Receipt PAGO stamp ── */}
      {!isInvoice && (
        <div style={{ textAlign: 'center', margin: '20px 0', fontSize: '32px', fontWeight: 900, color: '#166534', border: '4px solid #166534', borderRadius: 8, padding: '8px 0', letterSpacing: 8 }}>
          PAGO
        </div>
      )}

      <InvoiceDocFooter marginTop={28} />
    </div>
  )
}
