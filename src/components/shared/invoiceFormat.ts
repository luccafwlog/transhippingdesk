import type { InvoiceDetail } from '../../services/billing'
import { formatDate } from '../../lib/utils'
import type React from 'react'

// Helpers de formatação e estilos compartilhados pelos documentos imprimíveis
// de fatura (ver InvoiceDocumentKit.tsx para os blocos JSX compartilhados).

export function fmtBRL(v: number | null | undefined) {
  const n = Number(v ?? 0)
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtCNPJ(s: string | null | undefined) {
  if (!s) return ''
  const d = s.replace(/\D/g, '')
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  return s
}

export function longDate() {
  return new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

// Etapa 1 do plano de faturamento (ADR 0038, achado 3): o detalhamento de uma
// invoice individual vem congelado em invoice_items desde a emissão (migration
// 025_billing_orchestration_portal.sql), então recálculos posteriores do B/L
// não o alteram. Consolidadas são a exceção real: o breakdown por B/L é
// reconstruído a partir de charge_calculations em tempo de leitura
// (hydrateConsolidatedInvoiceDetails em services/billing.ts), então afirmar
// "congelado" aí seria enganoso — ver docs/modules/faturamento.md, "Breakdown derivado".
export function describeInvoiceItemsFreezeNote(invoice: { invoice_type?: string | null; issued_at?: string | null }) {
  if (invoice.invoice_type === 'consolidated') {
    return `Emitida em ${formatDate(invoice.issued_at)}. Consolidada: o detalhamento por B/L é reconstruído a partir do cálculo atual de taxas locais, não é um snapshot congelado na emissão.`
  }
  return `Itens automáticos (Origem: Auto) refletem o cálculo do B/L congelado na emissão (${formatDate(invoice.issued_at)}) e não mudam com recálculos posteriores. Itens manuais podem ter sido lançados depois da emissão — veja a coluna Origem.`
}

export const cell: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #e5e7eb' }
export const labelCell: React.CSSProperties = { ...cell, fontWeight: 700, width: 130, whiteSpace: 'nowrap' }

export const documentRoot: React.CSSProperties = { fontFamily: 'Arial, sans-serif', fontSize: '13px', color: '#111', background: 'white' }

// Nome padronizado do arquivo de fatura de taxas locais (sem extensao):
// "NumeroFatura - FATURA TAXAS LOCAIS - PrimeiroNomeCliente - BL(s)".
// Ex.: "INV-2026-0127 - FATURA TAXAS LOCAIS - GOLDEN - CSC45630201C00".
export function buildInvoiceFileBaseName(detail: InvoiceDetail): string {
  const invoice = detail.invoice
  const invoiceNumber = invoice?.invoice_number ?? (invoice ? `INV-${invoice.id}` : 'Fatura')
  const firstName = (invoice?.customer_name ?? '').trim().split(/\s+/)[0] ?? ''
  const blPart = detail.bls.map((b) => b.bl_id).filter(Boolean).join(', ')
  const base = [invoiceNumber, 'FATURA TAXAS LOCAIS', firstName, blPart]
    .filter((part) => part && part.trim().length > 0)
    .join(' - ')
  // Remove caracteres invalidos em nomes de arquivo e normaliza espacos.
  return base.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim()
}
