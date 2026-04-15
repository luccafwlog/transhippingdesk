import { jsPDF } from 'jspdf'
import { COMPANY } from '../config/company'
import type { InvoiceDetail } from './billing'

type PdfCursor = {
  y: number
}

const MARGIN = 40
const LINE_HEIGHT = 14
const PAGE_BOTTOM = 790

function formatMoney(value: number | null | undefined) {
  const numeric = Number(value ?? 0)
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(numeric) ? numeric : 0)
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '-'
  return parsed.toLocaleDateString('pt-BR')
}

function ensureSpace(doc: jsPDF, cursor: PdfCursor, minHeight: number) {
  if (cursor.y + minHeight <= PAGE_BOTTOM) return
  doc.addPage()
  cursor.y = MARGIN
}

function writeKeyValue(doc: jsPDF, cursor: PdfCursor, key: string, value: string) {
  ensureSpace(doc, cursor, LINE_HEIGHT * 2)
  doc.setFont('helvetica', 'bold')
  doc.text(key, MARGIN, cursor.y)
  doc.setFont('helvetica', 'normal')
  const wrapped = doc.splitTextToSize(value || '-', 360)
  doc.text(wrapped, MARGIN + 110, cursor.y)
  cursor.y += Math.max(LINE_HEIGHT, wrapped.length * LINE_HEIGHT)
}

function drawSectionTitle(doc: jsPDF, cursor: PdfCursor, title: string) {
  ensureSpace(doc, cursor, 28)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text(title, MARGIN, cursor.y)
  cursor.y += 8
  doc.setDrawColor(21, 37, 68)
  doc.line(MARGIN, cursor.y, 555, cursor.y)
  cursor.y += 14
  doc.setFontSize(10)
}

function drawItemsHeader(doc: jsPDF, cursor: PdfCursor) {
  ensureSpace(doc, cursor, 24)
  doc.setFillColor(21, 37, 68)
  doc.rect(MARGIN, cursor.y - 10, 515, 20, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.text('Descricao', MARGIN + 6, cursor.y + 3)
  doc.text('Qtd', 365, cursor.y + 3, { align: 'right' })
  doc.text('Unitario', 455, cursor.y + 3, { align: 'right' })
  doc.text('Total', 545, cursor.y + 3, { align: 'right' })
  doc.setTextColor(20, 20, 20)
  doc.setFont('helvetica', 'normal')
  cursor.y += 18
}

function drawItemRow(
  doc: jsPDF,
  cursor: PdfCursor,
  description: string,
  quantity: number | null | undefined,
  unitValueBrl: number | null | undefined,
  totalValueBrl: number | null | undefined,
) {
  const descLines = doc.splitTextToSize(description || '-', 285)
  const rowHeight = Math.max(18, descLines.length * 12)
  ensureSpace(doc, cursor, rowHeight + 6)
  if (cursor.y + rowHeight > PAGE_BOTTOM) {
    doc.addPage()
    cursor.y = MARGIN
    drawItemsHeader(doc, cursor)
  }

  doc.setFont('helvetica', 'normal')
  doc.text(descLines, MARGIN + 6, cursor.y)
  doc.text(String(quantity ?? 1), 365, cursor.y, { align: 'right' })
  doc.text(formatMoney(unitValueBrl), 455, cursor.y, { align: 'right' })
  doc.text(formatMoney(totalValueBrl), 545, cursor.y, { align: 'right' })
  cursor.y += rowHeight
  doc.setDrawColor(224, 224, 224)
  doc.line(MARGIN, cursor.y + 2, 555, cursor.y + 2)
  cursor.y += 8
}

export async function downloadInvoicePdf(detail: InvoiceDetail) {
  if (!detail.invoice) {
    throw new Error('Invoice indisponivel para gerar PDF.')
  }

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  })
  const cursor: PdfCursor = { y: MARGIN }
  const invoice = detail.invoice
  const invoiceNumber = invoice.invoice_number ?? `INV-${invoice.id}`

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('TRANSHIPPING - FATURA DE TAXAS LOCAIS', MARGIN, cursor.y)
  doc.setFontSize(11)
  doc.text(invoiceNumber, 555, cursor.y, { align: 'right' })
  cursor.y += 22
  doc.setDrawColor(21, 37, 68)
  doc.line(MARGIN, cursor.y, 555, cursor.y)
  cursor.y += 16

  doc.setFontSize(10)
  writeKeyValue(doc, cursor, 'Cliente', invoice.customer_name ?? '-')
  writeKeyValue(doc, cursor, 'CNPJ/CPF', invoice.customer_cnpj_cpf ?? '-')
  writeKeyValue(doc, cursor, 'Emissao', formatDate(invoice.issued_at))
  writeKeyValue(doc, cursor, 'Vencimento', formatDate(invoice.due_date))
  writeKeyValue(doc, cursor, 'Status', invoice.status ?? 'issued')

  drawSectionTitle(doc, cursor, 'B/Ls vinculados')
  if (detail.bls.length === 0) {
    writeKeyValue(doc, cursor, 'B/L', '-')
  } else {
    for (const link of detail.bls) {
      const route = `${link.pol ?? '-'} -> ${link.pod ?? '-'}`
      const voyage = [link.vessel_name, link.voyage_number].filter(Boolean).join(' / ') || '-'
      writeKeyValue(doc, cursor, 'B/L', `${link.bl_id} | ${route}`)
      writeKeyValue(doc, cursor, 'Viagem', voyage)
      writeKeyValue(doc, cursor, 'Subtotal', formatMoney(link.subtotal_brl))
      cursor.y += 4
    }
  }

  drawSectionTitle(doc, cursor, 'Itens da invoice')
  drawItemsHeader(doc, cursor)
  if (detail.items.length === 0) {
    drawItemRow(doc, cursor, 'Sem itens', 0, 0, 0)
  } else {
    for (const item of detail.items) {
      drawItemRow(doc, cursor, item.description ?? '-', item.quantity, item.unit_value_brl, item.total_value_brl)
    }
  }

  ensureSpace(doc, cursor, 84)
  doc.setFillColor(21, 37, 68)
  doc.rect(365, cursor.y - 8, 190, 24, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.text(`TOTAL: ${formatMoney(invoice.total_brl)}`, 548, cursor.y + 8, { align: 'right' })
  doc.setTextColor(20, 20, 20)
  cursor.y += 30
  doc.setFillColor(240, 144, 10)
  doc.rect(365, cursor.y - 8, 190, 24, 'F')
  doc.setTextColor(255, 255, 255)
  doc.text(`SALDO: ${formatMoney(invoice.balance_brl)}`, 548, cursor.y + 8, { align: 'right' })
  doc.setTextColor(20, 20, 20)
  cursor.y += 36

  drawSectionTitle(doc, cursor, 'Dados bancarios')
  writeKeyValue(doc, cursor, 'Empresa', COMPANY.name)
  writeKeyValue(doc, cursor, 'CNPJ', COMPANY.cnpj)
  writeKeyValue(doc, cursor, 'Banco', COMPANY.bank)
  writeKeyValue(doc, cursor, 'Agencia', COMPANY.agency)
  writeKeyValue(doc, cursor, 'Conta', COMPANY.account)

  if (invoice.pix_payload) {
    drawSectionTitle(doc, cursor, 'PIX copia e cola')
    const pixLines = doc.splitTextToSize(invoice.pix_payload, 500)
    ensureSpace(doc, cursor, pixLines.length * LINE_HEIGHT + 10)
    doc.setFont('helvetica', 'normal')
    doc.text(pixLines, MARGIN, cursor.y)
  }

  doc.save(`${invoiceNumber}.pdf`)
}
