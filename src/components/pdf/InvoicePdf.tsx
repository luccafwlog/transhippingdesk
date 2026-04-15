import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { InvoiceDetail } from '../../services/billing'
import { COMPANY } from '../../config/company'

const C = {
  navy: '#152544',
  orange: '#F0900A',
  white: '#ffffff',
  textDark: '#1a1a1a',
  textGray: '#555555',
  bgLight: '#f7f7f7',
  border: '#d0d0d0',
  blHeader: '#dde4ee',
}

const s = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: C.textDark,
    backgroundColor: C.white,
    paddingHorizontal: 36,
    paddingTop: 28,
    paddingBottom: 28,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  logo: { width: 90, height: 36 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontFamily: 'Helvetica-Bold', fontSize: 12 },
  headerNumberBlock: { alignItems: 'flex-end' },
  headerNumberLabel: { fontSize: 7, color: C.textGray },
  headerNumber: { fontFamily: 'Helvetica-Bold', fontSize: 10, color: C.navy },
  divider: { height: 2, backgroundColor: C.navy, marginBottom: 10 },

  section: { marginBottom: 8 },
  infoRow: { flexDirection: 'row', marginBottom: 3 },
  infoLabel: { fontFamily: 'Helvetica-Bold', width: 80, fontSize: 9 },
  infoValue: { flex: 1, color: C.textGray, fontSize: 9 },

  blBox: { borderWidth: 1, borderColor: C.border, marginBottom: 6, padding: 7 },
  blBoxGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  blBoxCell: { width: '50%', flexDirection: 'row', marginBottom: 3 },

  tableContainer: { marginBottom: 8 },
  tableHeader: { flexDirection: 'row', backgroundColor: C.navy, paddingVertical: 5, paddingHorizontal: 5 },
  tHText: { color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 8 },
  tableBlRow: { flexDirection: 'row', backgroundColor: C.blHeader, paddingVertical: 3, paddingHorizontal: 5 },
  tableBlText: { fontFamily: 'Helvetica-Bold', fontSize: 8, color: C.navy },
  tableRow: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 5, borderBottomWidth: 1, borderBottomColor: C.border },
  tableRowAlt: { backgroundColor: C.bgLight },
  tCell: { fontSize: 8.5, color: C.textDark },

  colDesc: { flex: 3 },
  colQty: { width: 40, textAlign: 'center' },
  colUnit: { width: 72, textAlign: 'right' },
  colTotal: { width: 80, textAlign: 'right' },

  totalsContainer: { alignItems: 'flex-end', marginBottom: 14 },
  totalRow: {
    flexDirection: 'row',
    backgroundColor: C.navy,
    paddingVertical: 5,
    paddingHorizontal: 10,
    width: 220,
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  totalText: { color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 9 },
  vencRow: {
    flexDirection: 'row',
    backgroundColor: C.orange,
    paddingVertical: 5,
    paddingHorizontal: 10,
    width: 220,
    justifyContent: 'space-between',
  },
  vencText: { color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 9 },

  sectionTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9.5,
    marginBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingBottom: 3,
  },
  bankText: { color: C.textGray, fontSize: 8.5, lineHeight: 1.6 },

  pixRow: { flexDirection: 'row', marginTop: 10 },
  pixQr: { width: 76, height: 76, marginRight: 12 },
  pixTextCol: { flex: 1 },
  pixTitle: { fontFamily: 'Helvetica-Bold', fontSize: 10, marginBottom: 3 },
  pixAmountLabel: { fontSize: 7.5, color: C.textGray, marginBottom: 2 },
  pixAmountBox: {
    backgroundColor: C.orange,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 6,
    marginTop: 2,
  },
  pixAmountBoxText: { color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 10 },
  pixColaLabel: { fontFamily: 'Helvetica-Bold', fontSize: 7.5, marginBottom: 2 },
  pixCola: { fontSize: 6, color: C.textGray },

  footer: { marginTop: 16, textAlign: 'right', color: C.textGray, fontSize: 7.5 },
})

function fmtBRL(value: number | null | undefined): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '-'
  return (
    'R$ ' +
    n.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return '-'
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  return new Date(value).toLocaleDateString('pt-BR')
}

function fmtCityDate(): string {
  return new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Sao_Paulo',
  })
}

type ParsedItem = {
  chargeName: string
  quantity: number | null
  unitValue: number | null
  totalValue: number
}

function groupItemsByBl(items: InvoiceDetail['items']): Map<string, ParsedItem[]> {
  const groups = new Map<string, ParsedItem[]>()
  for (const item of items) {
    const sepIdx = item.description.indexOf(' - ')
    let blId = ''
    let chargeName = item.description
    if (sepIdx > 0 && item.description.startsWith('BL ')) {
      blId = item.description.slice(3, sepIdx)
      chargeName = item.description.slice(sepIdx + 3)
    }
    if (!groups.has(blId)) groups.set(blId, [])
    groups.get(blId)!.push({
      chargeName,
      quantity: item.quantity,
      unitValue: item.unit_value_brl,
      totalValue: item.total_value_brl,
    })
  }
  return groups
}

export type InvoicePdfProps = {
  invoice: InvoiceDetail
  logoDataUrl: string
  pixQrDataUrl?: string | null
}

export function InvoicePdf({ invoice, logoDataUrl, pixQrDataUrl }: InvoicePdfProps) {
  const inv = invoice.invoice
  if (!inv) {
    return (
      <Document>
        <Page size="A4" style={s.page}>
          <Text>Dados indisponíveis.</Text>
        </Page>
      </Document>
    )
  }

  const bls = invoice.bls
  const itemsByBl = groupItemsByBl(invoice.items)

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* HEADER */}
        <View style={s.headerRow}>
          <Image style={s.logo} src={logoDataUrl} />
          <View style={s.headerCenter}>
            <Text style={s.headerTitle}>FATURA DE TAXAS LOCAIS</Text>
          </View>
          <View style={s.headerNumberBlock}>
            <Text style={s.headerNumberLabel}>Nº DA FATURA</Text>
            <Text style={s.headerNumber}>{inv.invoice_number ?? `INV-${inv.id}`}</Text>
          </View>
        </View>
        <View style={s.divider} />

        {/* DADOS DO CLIENTE */}
        <View style={s.section}>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Cliente:</Text>
            <Text style={s.infoValue}>{inv.customer_name ?? '-'}</Text>
          </View>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>CNPJ:</Text>
            <Text style={s.infoValue}>{inv.customer_cnpj_cpf ?? '-'}</Text>
          </View>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Emissão:</Text>
            <Text style={s.infoValue}>{fmtDate(inv.issued_at)}</Text>
          </View>
        </View>

        {/* DADOS DOS B/Ls */}
        {bls.map((bl) => (
          <View key={bl.id} style={s.blBox}>
            <View style={s.blBoxGrid}>
              <View style={s.blBoxCell}>
                <Text style={s.infoLabel}>BL:</Text>
                <Text style={s.infoValue}>{bl.bl_id}</Text>
              </View>
              {bl.vessel_name ? (
                <View style={s.blBoxCell}>
                  <Text style={s.infoLabel}>Navio/Voy:</Text>
                  <Text style={s.infoValue}>
                    {bl.vessel_name}
                    {bl.voyage_number ? ` ${bl.voyage_number}` : ''}
                  </Text>
                </View>
              ) : null}
              {bl.pol ? (
                <View style={s.blBoxCell}>
                  <Text style={s.infoLabel}>From:</Text>
                  <Text style={s.infoValue}>{bl.pol}</Text>
                </View>
              ) : null}
              {bl.pod ? (
                <View style={s.blBoxCell}>
                  <Text style={s.infoLabel}>To:</Text>
                  <Text style={s.infoValue}>{bl.pod}</Text>
                </View>
              ) : null}
            </View>
          </View>
        ))}

        {/* TABELA DE TAXAS */}
        <View style={s.tableContainer}>
          <View style={s.tableHeader}>
            <Text style={[s.tHText, s.colDesc]}>DESCRIÇÃO</Text>
            <Text style={[s.tHText, s.colQty]}>QTD</Text>
            <Text style={[s.tHText, s.colUnit]}>VALOR UNIT.</Text>
            <Text style={[s.tHText, s.colTotal]}>TOTAL BRL</Text>
          </View>

          {Array.from(itemsByBl.entries()).map(([blId, items]) => (
            <View key={blId}>
              {blId ? (
                <View style={s.tableBlRow}>
                  <Text style={s.tableBlText}>BL: {blId}</Text>
                </View>
              ) : null}
              {items.map((item, idx) => (
                <View key={idx} style={idx % 2 === 1 ? [s.tableRow, s.tableRowAlt] : s.tableRow}>
                  <Text style={[s.tCell, s.colDesc]}>{item.chargeName}</Text>
                  <Text style={[s.tCell, s.colQty]}>{item.quantity ?? 1}</Text>
                  <Text style={[s.tCell, s.colUnit]}>{item.unitValue != null ? fmtBRL(item.unitValue) : '-'}</Text>
                  <Text style={[s.tCell, s.colTotal]}>{fmtBRL(item.totalValue)}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>

        {/* TOTAIS */}
        <View style={s.totalsContainer}>
          <View style={s.totalRow}>
            <Text style={s.totalText}>TOTAL:</Text>
            <Text style={s.totalText}>{fmtBRL(inv.total_brl)}</Text>
          </View>
          {inv.due_date ? (
            <View style={s.vencRow}>
              <Text style={s.vencText}>VENCIMENTO DIA</Text>
              <Text style={s.vencText}>{fmtDate(inv.due_date)}</Text>
            </View>
          ) : null}
        </View>

        {/* DETALHES BANCÁRIOS */}
        <View>
          <Text style={s.sectionTitle}>DETALHES BANCÁRIOS</Text>
          <Text style={s.bankText}>{COMPANY.name}</Text>
          <Text style={s.bankText}>CNPJ {COMPANY.cnpj}</Text>
          <Text style={s.bankText}>BANCO: {COMPANY.bank}</Text>
          <Text style={s.bankText}>AGÊNCIA: {COMPANY.agency}</Text>
          <Text style={s.bankText}>CONTA CORRENTE {COMPANY.account}</Text>
        </View>

        {/* PIX */}
        {pixQrDataUrl && inv.pix_payload ? (
          <View style={s.pixRow}>
            <Image style={s.pixQr} src={pixQrDataUrl} />
            <View style={s.pixTextCol}>
              <Text style={s.pixTitle}>PAGAMENTO VIA PIX</Text>
              <Text style={s.pixAmountLabel}>
                Escaneie o QR Code ao lado ou utilize o código Pix Copia e Cola abaixo para realizar o pagamento.
              </Text>
              <Text style={s.pixAmountLabel}>Valor da fatura:</Text>
              <View style={s.pixAmountBox}>
                <Text style={s.pixAmountBoxText}>{fmtBRL(inv.total_brl)}</Text>
              </View>
              <Text style={s.pixColaLabel}>PIX COPIA E COLA</Text>
              <Text style={s.pixCola}>{inv.pix_payload}</Text>
            </View>
          </View>
        ) : null}

        {/* RODAPÉ */}
        <Text style={s.footer}>
          {COMPANY.city}, {fmtCityDate()}
        </Text>
      </Page>
    </Document>
  )
}
