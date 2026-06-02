import React from 'react'
import { QRCodeSVG } from 'qrcode.react'
import type { InvoiceDetail } from '../../services/billing'
import { stripBlPrefix } from '../../lib/utils'

function fmtBRL(v: number | null | undefined) {
  const n = Number(v ?? 0)
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtCNPJ(s: string | null | undefined) {
  if (!s) return ''
  const d = s.replace(/\D/g, '')
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  return s
}


function longDate() {
  return new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

const cell: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #e5e7eb' }
const labelCell: React.CSSProperties = { ...cell, fontWeight: 700, width: 130, whiteSpace: 'nowrap' }

type Props = { detail: InvoiceDetail }

export function InvoiceDocumentLocal({ detail }: Props) {
  const { invoice, bls, items } = detail
  if (!invoice) return null

  const isConsolidated = bls.length >= 2
  const title = isConsolidated ? 'FATURA CONSOLIDADA DE TAXAS LOCAIS' : 'FATURA DE TAXAS LOCAIS'

  const blIds = bls.map((b) => b.bl_id).join(', ') || '—'

  const vesselVoyages = Array.from(
    new Set(
      bls
        .filter((b) => b.vessel_name || b.voyage_number)
        .map((b) => `${b.vessel_name ?? ''} ${b.voyage_number ?? ''}`.trim()),
    ),
  ).join(', ') || '—'

  // Pre-compute flat item index for zebra striping (avoids mutation during render)
  const itemFlatIndex = new Map<number | string, number>()
  let flatIdx = 0
  for (const bl of bls) {
    for (const item of items.filter((i) => i.bl_id === bl.bl_id)) {
      itemFlatIndex.set(item.id, flatIdx++)
    }
  }

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', fontSize: '13px', color: '#111', background: 'white' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <img
          src="/branding/transhipping-logo-cropped.png"
          alt="Transhipping"
          style={{ height: 52 }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#1A2744' }}>
          Nº {invoice.invoice_number ?? `INV-${invoice.id}`}
        </div>
      </div>

      {/* Title */}
      <div style={{ textAlign: 'center', fontSize: '16px', fontWeight: 700, textTransform: 'uppercase', margin: '12px 0 6px' }}>
        {title}
      </div>
      <hr style={{ border: 'none', borderTop: '2px solid #111', margin: '0 0 16px' }} />

      {/* Metadata */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
        <tbody>
          <tr>
            <td style={labelCell}>Cliente:</td>
            <td style={cell}>
              {invoice.customer_name ?? '—'}
              {invoice.customer_cnpj_cpf ? <><br />CNPJ: {fmtCNPJ(invoice.customer_cnpj_cpf)}</> : ''}
            </td>
          </tr>
          <tr>
            <td style={labelCell}>B/Ls:</td>
            <td style={{ ...cell, color: '#1A2744', fontWeight: 600 }}>{blIds}</td>
          </tr>
          <tr>
            <td style={labelCell}>Navio/Voy.:</td>
            <td style={cell}>{vesselVoyages}</td>
          </tr>
        </tbody>
      </table>

      {/* Items table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', margin: '16px 0', fontSize: '12px' }}>
        <thead>
          <tr style={{ background: '#1A2744', color: 'white' }}>
            <th scope="col" style={{ padding: '9px 7px', textAlign: 'left' }}>Descrição</th>
            <th scope="col" style={{ padding: '9px 7px', textAlign: 'center' }}>Qtd</th>
            <th scope="col" style={{ padding: '9px 7px', textAlign: 'right' }}>Unit. BRL</th>
            <th scope="col" style={{ padding: '9px 7px', textAlign: 'right' }}>Total BRL</th>
          </tr>
        </thead>
        <tbody>
          {isConsolidated
            ? bls.map((blMeta) => {
                const blId = blMeta.bl_id
                const blItems = items.filter((item) => item.bl_id === blId)
                const subtotal = blItems.reduce((s, i) => s + Number(i.total_value_brl ?? 0), 0)
                const route = `${blMeta.pol ?? ''} → ${blMeta.pod ?? ''}`.trim().replace(/^→\s*/, '').replace(/\s*→$/, '')
                return (
                  <React.Fragment key={blId}>
                    <tr style={{ background: '#e8edf5' }}>
                      <td colSpan={4} style={{ padding: '6px 8px', fontWeight: 700, color: '#1A2744', fontSize: '11px' }}>
                        B/L {blId}{route && route !== '→' ? ` — ${route}` : ''}
                      </td>
                    </tr>
                    {blItems.map((item) => {
                      const bg = (itemFlatIndex.get(item.id) ?? 0) % 2 === 0 ? '#f9fafb' : 'white'
                      return (
                        <tr key={item.id} style={{ background: bg, borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '8px 8px 8px 16px' }}>{stripBlPrefix(item.description, item.bl_id)}</td>
                          <td style={{ padding: '8px 7px', textAlign: 'center' }}>{item.quantity ?? 1}</td>
                          <td style={{ padding: '8px 7px', textAlign: 'right' }}>{fmtBRL(item.unit_value_brl)}</td>
                          <td style={{ padding: '8px 7px', textAlign: 'right', fontWeight: 600 }}>{fmtBRL(item.total_value_brl)}</td>
                        </tr>
                      )
                    })}
                    <tr style={{ background: '#f0f4fa', borderBottom: '2px solid #c8d4e8' }}>
                      <td colSpan={3} style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: '#1A2744' }}>
                        Subtotal {blId}:
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: '#1A2744' }}>
                        {fmtBRL(subtotal)}
                      </td>
                    </tr>
                  </React.Fragment>
                )
              })
            : items.map((item, idx) => (
                <tr key={item.id} style={{ background: idx % 2 === 0 ? '#f9fafb' : 'white', borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '8px 7px' }}>{stripBlPrefix(item.description, item.bl_id)}</td>
                  <td style={{ padding: '8px 7px', textAlign: 'center' }}>{item.quantity ?? 1}</td>
                  <td style={{ padding: '8px 7px', textAlign: 'right' }}>{fmtBRL(item.unit_value_brl)}</td>
                  <td style={{ padding: '8px 7px', textAlign: 'right', fontWeight: 600 }}>{fmtBRL(item.total_value_brl)}</td>
                </tr>
              ))}
          <tr style={{ background: '#F59E0B' }}>
            <td colSpan={3} style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700 }}>TOTAL:</td>
            <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700 }}>{fmtBRL(invoice.total_brl)}</td>
          </tr>
        </tbody>
      </table>

      {/* PIX */}
      {invoice.pix_payload && (
        <div style={{ display: 'flex', gap: 18, marginTop: 20, paddingTop: 16, borderTop: '1px solid #e5e7eb', alignItems: 'flex-start' }}>
          <div style={{ flexShrink: 0 }}>
            <QRCodeSVG value={invoice.pix_payload} size={90} level="M" />
          </div>
          <div style={{ flex: 1, fontSize: '12px', color: '#333', lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: 4 }}>PAGAMENTO VIA PIX</div>
            <div>Escaneie o QR Code ao lado ou utilize o código Pix Copia e Cola abaixo para realizar o pagamento.</div>
            <div style={{ marginTop: 4 }}>Valor da fatura:</div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{fmtBRL(invoice.total_brl)}</div>
            <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 3 }}>PIX COPIA E COLA</div>
            <span style={{ display: 'block', fontFamily: 'monospace', fontSize: '8px', background: '#f3f4f6', padding: '5px 8px', borderRadius: 3, wordBreak: 'break-all', color: '#374151' }}>
              {invoice.pix_payload}
            </span>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: 24, textAlign: 'right', fontSize: '12px', color: '#555' }}>
        Vitória, {longDate()}
      </div>
    </div>
  )
}
