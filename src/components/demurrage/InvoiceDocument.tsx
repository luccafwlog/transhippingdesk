import { QRCodeSVG } from 'qrcode.react'
import type { DemurrageInvoiceDetail } from '../../types/database'
import { COMPANY } from '../../config/company'

type Props = {
  detail: DemurrageInvoiceDetail
  type: 'invoice' | 'receipt'
}

function fmtBRL(v: number) {
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtUSD(v: number) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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

const cell: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #e5e7eb' }
const labelCell: React.CSSProperties = { ...cell, fontWeight: 700, width: 130, whiteSpace: 'nowrap' }

export function InvoiceDocument({ detail, type }: Props) {
  const { items, customer, bl, ...invoice } = detail
  const isInvoice = type === 'invoice'

  const vessel = bl?.voyage?.vessel?.name ?? '—'
  const voyageNumber = bl?.voyage?.voyage_number ?? '—'
  const containerList = items.map((i) => i.container_number).join(', ')

  const roe = invoice.frozen_roe ?? invoice.roe ?? null
  const roeValue = roe ?? 1

  // Per-row BRL = subtotal_usd × roe
  const itemsWithBRL = items.map((item) => ({
    ...item,
    subtotal_brl: item.subtotal_usd * roeValue,
  }))

  const rawTotalBRL = itemsWithBRL.reduce((s, i) => s + i.subtotal_brl, 0)

  let discountAmt = 0
  if (invoice.discount_value && invoice.discount_value > 0) {
    if (invoice.discount_mode === 'percent') {
      discountAmt = rawTotalBRL * (invoice.discount_value / 100)
    } else {
      discountAmt = invoice.discount_value
    }
  }

  const totalBRL = invoice.frozen_total_brl ?? Math.max(0, rawTotalBRL - discountAmt)
  const hasDiscount = (invoice.discount_value ?? 0) > 0

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', fontSize: '13px', color: '#111', background: 'white' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <img src="/branding/tr-logo.png" alt="Transhipping" style={{ height: 52 }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#1A2744' }}>Nº {invoice.doc_number}</div>
      </div>

      {/* ── Title ── */}
      <div style={{ textAlign: 'center', fontSize: '16px', fontWeight: 700, margin: '12px 0 6px' }}>
        {isInvoice ? 'FATURA DE SOBREESTADIA DE CONTAINER' : 'RECIBO DE QUITAÇÃO DE SOBREESTADIA'}
      </div>
      <hr style={{ border: 'none', borderTop: '2px solid #111', margin: '0 0 16px' }} />

      {/* ── Client block ── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
        <tbody>
          <tr>
            <td style={labelCell}>Cliente:</td>
            <td style={cell}>
              {customer?.name ?? '—'}
              {customer?.cnpj_cpf ? <><br />CNPJ: {fmtCNPJ(customer.cnpj_cpf)}</> : ''}
            </td>
          </tr>
        </tbody>
      </table>
      <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '0 0 0' }} />

      {/* ── Shipment info ── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
        <tbody>
          {[
            ['BL', invoice.bl_id],
            ['Container(s)', containerList || '—'],
            ['Navio/Voy:', `${vessel} ${voyageNumber}`],
            ['From:', bl?.pol ?? '—'],
            ['To:', bl?.pod ?? '—'],
          ].map(([label, value]) => (
            <tr key={label}>
              <td style={labelCell}>{label}</td>
              <td style={cell}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── ROE badge ── */}
      {roe && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <div style={{ background: '#F59E0B', padding: '5px 18px', display: 'flex', gap: 24, fontWeight: 700, borderRadius: 3, fontSize: '13px' }}>
            <span>ROE</span>
            <span>{roe.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</span>
          </div>
        </div>
      )}

      {/* ── Items table ── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 0, fontSize: '12px' }}>
        <thead>
          <tr style={{ background: '#1A2744', color: 'white' }}>
            {['CONTAINER', 'TIPO', 'DIAS 1º PER.', 'USD/Dia', 'DIAS 2º PER.', 'USD/Dia', 'DESCARGA', 'RETORNO', 'LÍQUIDO'].map((h) => (
              <th scope="col" key={h} style={{ padding: '9px 8px', textAlign: h === 'CONTAINER' ? 'left' : 'center', fontWeight: 600, fontSize: '11px' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {itemsWithBRL.map((item, idx) => (
            <tr key={item.id} style={{ background: idx % 2 === 0 ? '#f9fafb' : 'white', borderBottom: '1px solid #e5e7eb' }}>
              <td style={{ padding: '8px', fontWeight: 600 }}>{item.container_number}</td>
              <td style={{ padding: '8px', textAlign: 'center' }}>{item.container_type}</td>
              <td style={{ padding: '8px', textAlign: 'center' }}>{item.days_p1}</td>
              <td style={{ padding: '8px', textAlign: 'center' }}>{fmtUSD(item.rate_p1_usd)}</td>
              <td style={{ padding: '8px', textAlign: 'center' }}>{item.days_p2}</td>
              <td style={{ padding: '8px', textAlign: 'center' }}>{fmtUSD(item.rate_p2_usd)}</td>
              <td style={{ padding: '8px', textAlign: 'center' }}>{fmtDate(item.discharge_date)}</td>
              <td style={{ padding: '8px', textAlign: 'center' }}>{fmtDate(item.return_date)}</td>
              <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600 }}>{fmtBRL(item.subtotal_brl)}</td>
            </tr>
          ))}

          {hasDiscount && (
            <>
              <tr style={{ background: '#F59E0B' }}>
                <td colSpan={8} style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>SUBTOTAL:</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>{fmtBRL(rawTotalBRL)}</td>
              </tr>
              <tr style={{ background: '#f0fdf4' }}>
                <td colSpan={8} style={{ padding: '8px 10px', textAlign: 'right' }}>
                  DESCONTO {invoice.discount_mode === 'percent' ? `(${invoice.discount_value}%)` : 'FIXO'}
                  {invoice.discount_type ? ` — ${invoice.discount_type}` : ''}:
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: '#166534' }}>- {fmtBRL(discountAmt)}</td>
              </tr>
            </>
          )}

          <tr style={{ background: '#F59E0B' }}>
            <td colSpan={8} style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700 }}>
              {hasDiscount ? 'TOTAL FINAL:' : 'TOTAL:'}
            </td>
            <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700 }}>{fmtBRL(totalBRL)}</td>
          </tr>

          {isInvoice && invoice.due_date && (
            <tr style={{ background: '#1A2744', color: 'white' }}>
              <td colSpan={8} style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 600 }}>VENCIMENTO DIA</td>
              <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 600 }}>{fmtDate(invoice.due_date)}</td>
            </tr>
          )}

          {!isInvoice && invoice.paid_at && (
            <tr style={{ background: '#166534', color: 'white' }}>
              <td colSpan={8} style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 600 }}>DATA DE PAGAMENTO:</td>
              <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 600 }}>{fmtDate(invoice.paid_at)}</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* ── Bank details ── */}
      <div style={{ marginTop: 20, fontSize: '12.5px', lineHeight: 1.7 }}>
        <strong>DETALHES BANCÁRIOS</strong>
        <div style={{ marginTop: 4 }}>
          {COMPANY.name}<br />
          CNPJ {COMPANY.cnpj}<br />
          BANCO: {COMPANY.bank}<br />
          AGÊNCIA: {COMPANY.agency}<br />
          CONTA CORRENTE {COMPANY.account}
        </div>
        <div style={{ display: 'inline-block', background: '#F59E0B', fontWeight: 700, padding: '5px 14px', fontSize: '14px', borderRadius: 3, marginTop: 8 }}>
          {fmtBRL(totalBRL)}
        </div>
      </div>

      {/* ── PIX section ── */}
      {isInvoice && invoice.pix_payload && (
        <div style={{ display: 'flex', gap: 18, marginTop: 20, paddingTop: 16, borderTop: '1px solid #e5e7eb', alignItems: 'flex-start' }}>
          <div style={{ flexShrink: 0 }}>
            <QRCodeSVG value={invoice.pix_payload} size={90} level="M" />
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

      {/* ── Receipt PAGO stamp ── */}
      {!isInvoice && (
        <div style={{ textAlign: 'center', margin: '20px 0', fontSize: '32px', fontWeight: 900, color: '#166534', border: '4px solid #166534', borderRadius: 8, padding: '8px 0', letterSpacing: 8 }}>
          PAGO
        </div>
      )}

      {/* ── Footer ── */}
      <div style={{ marginTop: 28, textAlign: 'right', fontSize: '12px', color: '#555' }}>
        Vitória, {longDate()}
      </div>
    </div>
  )
}
