import { QRCodeSVG } from 'qrcode.react'
import type { InvoiceDetail } from '../../services/billing'

function fmtBRL(v: number | null | undefined) {
  const n = Number(v ?? 0)
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  const d = new Date(`${s}T12:00:00`)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
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

type Props = {
  detail: InvoiceDetail
}

export function InvoiceDocumentLocal({ detail }: Props) {
  const { invoice, bls, items, payments } = detail
  if (!invoice) return null

  const totalPaid = Number(invoice.total_paid_brl ?? 0)
  const balance = Number(invoice.balance_brl ?? invoice.total_brl ?? 0)

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
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#1A2744' }}>
          Nº {invoice.invoice_number ?? `INV-${invoice.id}`}
        </div>
      </div>

      <div style={{ textAlign: 'center', fontSize: '17px', fontWeight: 700, textTransform: 'uppercase', margin: '12px 0 4px' }}>
        FATURA DE TAXAS LOCAIS
      </div>
      <hr style={{ borderTop: '2px solid #1A2744', margin: '8px 0 16px' }} />

      {/* Client */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        <span style={{ fontWeight: 600, minWidth: 110 }}>Cliente:</span>
        <span>
          {invoice.customer_name ?? '—'}
          {invoice.customer_cnpj_cpf ? <><br />CNPJ: {fmtCNPJ(invoice.customer_cnpj_cpf)}</> : ''}
        </span>
      </div>
      <hr style={{ borderTop: '1px solid #ddd', margin: '10px 0' }} />

      {/* Invoice metadata */}
      {[
        ['Emissão', fmtDate(invoice.issued_at)],
        ['Vencimento', fmtDate(invoice.due_date)],
        ['B/Ls vinculados', bls.map((b) => b.bl_id).join(', ') || '—'],
        ...(invoice.notes ? [['Observações', invoice.notes]] : []),
      ].map(([label, value]) => (
        <div key={label} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <span style={{ fontWeight: 600, minWidth: 110 }}>{label}:</span>
          <span>{value}</span>
        </div>
      ))}

      {/* Items table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', margin: '16px 0', fontSize: '12px' }}>
        <thead>
          <tr style={{ background: '#1A2744', color: 'white' }}>
            <th style={{ padding: '9px 7px', textAlign: 'left' }}>Descrição</th>
            <th style={{ padding: '9px 7px', textAlign: 'center' }}>Qtd.</th>
            <th style={{ padding: '9px 7px', textAlign: 'right' }}>Unit. BRL</th>
            <th style={{ padding: '9px 7px', textAlign: 'right' }}>Total BRL</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr
              key={item.id}
              style={{ background: idx % 2 === 0 ? '#f9fafb' : 'white', borderBottom: '1px solid #eee' }}
            >
              <td style={{ padding: '8px 7px' }}>{item.description}</td>
              <td style={{ padding: '8px 7px', textAlign: 'center' }}>{item.quantity ?? 1}</td>
              <td style={{ padding: '8px 7px', textAlign: 'right' }}>{fmtBRL(item.unit_value_brl)}</td>
              <td style={{ padding: '8px 7px', textAlign: 'right', fontWeight: 600 }}>{fmtBRL(item.total_value_brl)}</td>
            </tr>
          ))}
          <tr style={{ background: '#F59E0B' }}>
            <td colSpan={3} style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700 }}>TOTAL:</td>
            <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700 }}>{fmtBRL(invoice.total_brl)}</td>
          </tr>
          {totalPaid > 0 && (
            <tr style={{ background: '#f0fdf4', color: '#166534' }}>
              <td colSpan={3} style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>PAGO:</td>
              <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{fmtBRL(totalPaid)}</td>
            </tr>
          )}
          {totalPaid > 0 && (
            <tr style={{ background: '#1A2744', color: 'white' }}>
              <td colSpan={3} style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700 }}>SALDO:</td>
              <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700 }}>{fmtBRL(balance)}</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Payments history */}
      {payments.length > 0 && (
        <>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Histórico de pagamentos</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', marginBottom: 16 }}>
            <thead>
              <tr style={{ background: '#f3f4f6' }}>
                <th style={{ padding: '6px 8px', textAlign: 'left' }}>Data</th>
                <th style={{ padding: '6px 8px', textAlign: 'left' }}>Método</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Valor BRL</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '6px 8px' }}>{fmtDate(p.paid_at ?? p.created_at)}</td>
                  <td style={{ padding: '6px 8px', textTransform: 'uppercase' }}>{p.payment_method ?? '—'}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmtBRL(p.amount_brl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

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
          {fmtBRL(balance > 0 ? balance : invoice.total_brl)}
        </div>
      </div>

      {/* PIX */}
      {invoice.pix_payload && (
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

      {/* Footer */}
      <div style={{ marginTop: 24, textAlign: 'right', fontSize: '12px', color: '#555' }}>
        Vitória, {longDate()}
      </div>
    </div>
  )
}
