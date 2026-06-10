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

export const cell: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #e5e7eb' }
export const labelCell: React.CSSProperties = { ...cell, fontWeight: 700, width: 130, whiteSpace: 'nowrap' }

export const documentRoot: React.CSSProperties = { fontFamily: 'Arial, sans-serif', fontSize: '13px', color: '#111', background: 'white' }
