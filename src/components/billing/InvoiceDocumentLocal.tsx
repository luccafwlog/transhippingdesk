import React from 'react'
import { QRCodeSVG } from 'qrcode.react'
import type { InvoiceDetail } from '../../services/billing'
import { formatDate, stripBlPrefix } from '../../lib/utils'
import { cell, dataTotalCell, dataTotalRow, describeUsdConversionNote, DOC_BORDER, DOC_GROUP, DOC_MUTED, DOC_NAVY, DOC_SUBTOTAL, documentRoot, fmtBRL, fmtCNPJ, labelCell, zebraRow } from '../shared/invoiceFormat'
import { InvoiceDocFooter, InvoiceDocHeader, InvoiceDocTitle } from '../shared/InvoiceDocumentKit'

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
    <div style={documentRoot}>
      <InvoiceDocHeader logoSrc="/branding/transhipping-logo-cropped.png" docNumber={invoice.invoice_number ?? `INV-${invoice.id}`} />

      <InvoiceDocTitle uppercase>{title}</InvoiceDocTitle>

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
            <td style={{ ...cell, color: DOC_NAVY, fontWeight: 600 }}>{blIds}</td>
          </tr>
          <tr>
            <td style={labelCell}>Navio/Voy.:</td>
            <td style={cell}>{vesselVoyages}</td>
          </tr>
          <tr>
            <td style={labelCell}>Emitida em:</td>
            <td style={cell}>{formatDate(invoice.issued_at)}</td>
          </tr>
        </tbody>
      </table>

      {/* Items table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', margin: '16px 0', fontSize: '12px' }}>
        <thead>
          <tr style={{ background: DOC_NAVY, color: 'white' }}>
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
                    <tr style={{ background: DOC_GROUP }}>
                      <td colSpan={4} style={{ padding: '6px 8px', fontWeight: 700, color: DOC_NAVY, fontSize: '11px' }}>
                        B/L {blId}{route && route !== '→' ? ` — ${route}` : ''}
                      </td>
                    </tr>
                    {blItems.map((item) => {
                                            const usdNote = describeUsdConversionNote(item)
                      return (
                        <tr key={item.id} style={zebraRow(itemFlatIndex.get(item.id) ?? 0)}>
                          <td style={{ padding: '8px 8px 8px 16px' }}>
                            {stripBlPrefix(item.description, item.bl_id)}
                            {usdNote && <div style={{ fontSize: '10px', color: DOC_MUTED }}>{usdNote}</div>}
                          </td>
                          <td style={{ padding: '8px 7px', textAlign: 'center' }}>{item.quantity ?? 1}</td>
                          <td style={{ padding: '8px 7px', textAlign: 'right' }}>{fmtBRL(item.unit_value_brl)}</td>
                          <td style={{ padding: '8px 7px', textAlign: 'right', fontWeight: 600 }}>{fmtBRL(item.total_value_brl)}</td>
                        </tr>
                      )
                    })}
                    <tr style={{ background: DOC_SUBTOTAL, borderBottom: '2px solid #c8d4e8' }}>
                      <td colSpan={3} style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: DOC_NAVY }}>
                        Subtotal {blId}:
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: DOC_NAVY }}>
                        {fmtBRL(subtotal)}
                      </td>
                    </tr>
                  </React.Fragment>
                )
              })
            : items.map((item, idx) => {
                const usdNote = describeUsdConversionNote(item)
                return (
                  <tr key={item.id} style={zebraRow(idx)}>
                    <td style={{ padding: '8px 7px' }}>
                      {stripBlPrefix(item.description, item.bl_id)}
                      {usdNote && <div style={{ fontSize: '10px', color: DOC_MUTED }}>{usdNote}</div>}
                    </td>
                    <td style={{ padding: '8px 7px', textAlign: 'center' }}>{item.quantity ?? 1}</td>
                    <td style={{ padding: '8px 7px', textAlign: 'right' }}>{fmtBRL(item.unit_value_brl)}</td>
                    <td style={{ padding: '8px 7px', textAlign: 'right', fontWeight: 600 }}>{fmtBRL(item.total_value_brl)}</td>
                  </tr>
                )
              })}
          <tr style={dataTotalRow}>
            <td colSpan={3} style={dataTotalCell}>TOTAL:</td>
            <td style={dataTotalCell}>{fmtBRL(invoice.total_brl)}</td>
          </tr>
        </tbody>
      </table>

      {/* PIX */}
      {invoice.pix_payload && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${DOC_BORDER}` }}>
          <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
            <div style={{ flexShrink: 0 }}>
              <QRCodeSVG value={invoice.pix_payload} size={90} level="M" />
            </div>
            <div style={{ flex: 1, fontSize: '12px', color: '#333', lineHeight: 1.6 }}>
              <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: 4 }}>PAGAMENTO VIA PIX</div>
              <div>Escaneie o QR Code ao lado ou utilize o código Pix Copia e Cola abaixo para realizar o pagamento.</div>
              <div style={{ marginTop: 4 }}>Valor da fatura:</div>
              <div style={{ fontWeight: 700 }}>{fmtBRL(invoice.total_brl)}</div>
            </div>
          </div>
          {/* Código em linha única e em largura total: a seleção (manual no PDF ou por
              clique na tela) copia a string exata, sem quebras que corrompam o payload. */}
          <div style={{ fontSize: '10px', color: DOC_MUTED, fontWeight: 600, letterSpacing: '0.05em', margin: '10px 0 3px' }}>PIX COPIA E COLA</div>
          <span
            onClick={(event) => {
              const selection = window.getSelection()
              if (!selection) return
              const range = document.createRange()
              range.selectNodeContents(event.currentTarget)
              selection.removeAllRanges()
              selection.addRange(range)
            }}
            title="Clique para selecionar o código inteiro"
            style={{ display: 'block', fontFamily: 'monospace', fontSize: '6.5px', background: '#f3f4f6', padding: '5px 8px', borderRadius: 3, whiteSpace: 'nowrap', color: '#374151', cursor: 'pointer', userSelect: 'all', WebkitUserSelect: 'all' }}
          >
            {invoice.pix_payload}
          </span>
        </div>
      )}

      <InvoiceDocFooter marginTop={24} />
    </div>
  )
}
