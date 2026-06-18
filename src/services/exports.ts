import { countDistinctContainerNumbers, countDistinctContainerNumbersBy } from '../lib/containerCounts'
import type { BLListItem, ContainerListItem, CustomerListItem, VaziosImportacaoContainerListItem } from '../types/database'
import type { BaplieContainer } from '../types/database'
import type { LocalChargeOperationalRow } from './charges/chargeOperationsService'
import type {
  CustomerReportRow,
  FinancialReportRow,
  OperationalReportRow,
} from './reports'
import { getInvoiceBls, getInvoicePaymentDate, isConsolidatedInvoice, type InvoiceListRow } from './billing'
import { invoiceStatusLabel } from '../pages/faturamentoInvoiceStatus'
import { formatDate } from '../lib/utils'
import type { PortalDemurrageInvoice, PortalInvoiceSummary } from './portalBilling'
import type { PortalOperationBL } from './portalOperation'
import type { PortalFlatContainer } from '../lib/portalOperationViews'

// Neutraliza injeção de fórmula (CSV/Excel injection). Dados de células vêm de
// arquivos de armador importados (não confiáveis): um valor iniciado por
// = + - @ ou tab/CR é interpretado como fórmula ao abrir no Excel/Sheets.
// Prefixar com aspa simples força o tratamento como texto literal.
const FORMULA_INJECTION_PREFIX = /^[=+\-@\t\r]/

function sanitizeCellValue<T>(value: T): T | string {
  if (typeof value === 'string' && FORMULA_INJECTION_PREFIX.test(value)) {
    return `'${value}`
  }
  return value
}

function toSheet<T extends Record<string, unknown>>(
  XLSX: typeof import('@e965/xlsx'),
  rows: T[],
) {
  const safeRows = rows.map((row) => {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      out[key] = sanitizeCellValue(value)
    }
    return out
  })
  return XLSX.utils.json_to_sheet(safeRows)
}

export async function exportManifestWorkbook(rows: BLListItem[]) {
  const XLSX = await import('@e965/xlsx')
  const manifestRows = rows.map((row) => ({
    BL: row.id,
    CEMercante: row.ce_mercante ?? '',
    Modalidade: row.cargo_mode === 'carga_solta' ? 'Carga Solta' : 'Container',
    Armador: row.voyage?.vessel?.carrier?.name ?? '',
    SCAC: row.voyage?.vessel?.carrier?.scac ?? '',
    Navio: row.voyage?.vessel?.name ?? '',
    Viagem: row.voyage?.voyage_number ?? '',
    Consignatario: row.customer?.name ?? row.consignee ?? '',
    CNPJ: row.customer?.cnpj_cpf ?? '',
    POL: row.pol ?? '',
    POD: row.pod ?? '',
    'Containers distintos': countDistinctContainerNumbers(row.bl_containers),
    'Containers OOG distintos': countDistinctContainerNumbersBy(row.bl_containers, (container) => Boolean(container.is_oog)),
    'Containers IMO distintos': countDistinctContainerNumbersBy(row.bl_containers, (container) => Boolean(container.is_imo)),
    PesoKg: row.total_weight_kg ?? '',
    CBM: row.total_cbm ?? '',
    Revisao: row.review_status ?? '',
    Financeiro: row.financial_status ?? '',
  }))

  const containerRows = rows.flatMap((row) =>
    (row.bl_containers ?? []).map((container) => ({
      Container: container.container_number,
      BL: row.id,
      CEMercante: row.ce_mercante ?? '',
      Tipo: container.type ?? '',
      Seal: container.seal_number ?? '',
      PesoBrutoKg: container.gross_weight_kg ?? '',
      CBM: container.cbm ?? '',
      OOG: container.is_oog ? 'SIM' : 'NAO',
      IMO: container.is_imo ? 'SIM' : 'NAO',
      IMOClass: container.imo_class ?? '',
      UNNumber: container.un_number ?? '',
      Consignatario: row.customer?.name ?? row.consignee ?? '',
      CNPJ: row.customer?.cnpj_cpf ?? '',
      Armador: row.voyage?.vessel?.carrier?.name ?? '',
      Navio: row.voyage?.vessel?.name ?? '',
      Viagem: row.voyage?.voyage_number ?? '',
      POL: row.pol ?? '',
      POD: row.pod ?? '',
    })),
  )

  const breakbulkRows = rows
    .filter((row) => row.cargo_mode === 'carga_solta')
    .map((row) => ({
      BL: row.id,
      CE: row.ce_mercante ?? '',
      MAQUINAS: row.bb_machine_qty ?? '',
      PACKAGES: row.bb_packages_qty ?? '',
      'PACKAGES TOTAL': row.bb_packages_total ?? row.bb_packages_qty ?? '',
      'WEIGHT (TON)': row.bb_weight_ton ?? (row.total_weight_kg ? Number(row.total_weight_kg) / 1000 : ''),
      'CBM (M3)': row.total_cbm ?? '',
      SHIPPER: row.shipper ?? '',
      CONSIGNEE: row.customer?.name ?? row.consignee ?? '',
      NOTIFY: row.notify_party ?? '',
      POL: row.pol ?? '',
      POD: row.pod ?? '',
      CNPJ: row.customer?.cnpj_cpf ?? '',
      Navio: row.voyage?.vessel?.name ?? '',
      Viagem: row.voyage?.voyage_number ?? '',
    }))

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, toSheet(XLSX, manifestRows), 'Manifestos')
  XLSX.utils.book_append_sheet(workbook, toSheet(XLSX, containerRows), 'Containers')
  XLSX.utils.book_append_sheet(workbook, toSheet(XLSX, breakbulkRows), 'CargaSolta')
  XLSX.writeFile(workbook, `manifestos-${makeTimestamp()}.xlsx`)
}

export async function exportContainerWorkbook(rows: ContainerListItem[]) {
  const XLSX = await import('@e965/xlsx')
  const exportRows = rows.map((row) => ({
    Container: row.container_number,
    BL: row.bl?.id ?? '',
    Armador: row.bl?.voyage?.vessel?.carrier?.name ?? '',
    Navio: row.bl?.voyage?.vessel?.name ?? '',
    Viagem: row.bl?.voyage?.voyage_number ?? '',
    Consignatario: row.bl?.customer?.name ?? row.bl?.consignee ?? '',
    CNPJ: row.bl?.customer?.cnpj_cpf ?? '',
    POL: row.bl?.pol ?? '',
    POD: row.bl?.pod ?? '',
    Tipo: row.type ?? '',
    Seal: row.seal_number ?? '',
    PesoBrutoKg: row.gross_weight_kg ?? '',
    CBM: row.cbm ?? '',
    OOG: row.is_oog ? 'SIM' : 'NAO',
    IMO: row.is_imo ? 'SIM' : 'NAO',
    IMOClass: row.imo_class ?? '',
    UNNumber: row.un_number ?? '',
    RevisaoBL: row.bl?.review_status ?? '',
    FinanceiroBL: row.bl?.financial_status ?? '',
  }))

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, toSheet(XLSX, exportRows), 'Containers')
  XLSX.writeFile(workbook, `containers-${makeTimestamp()}.xlsx`)
}

export async function exportInvoicesWorkbook(rows: InvoiceListRow[]) {
  const XLSX = await import('@e965/xlsx')

  const invoiceRows = rows.map((row) => {
    const bls = getInvoiceBls(row)
    const navios = Array.from(new Set(bls.map((bl) => bl.vessel_name).filter(Boolean))).join(' / ')
    const viagens = Array.from(new Set(bls.map((bl) => bl.voyage_number).filter(Boolean))).join(' / ')
    const pods = Array.from(new Set(bls.map((bl) => bl.pod).filter(Boolean))).join(' / ')
    return {
      Fatura: row.invoice_number ?? `INV-${row.id}`,
      Cliente: row.customer?.name ?? '',
      CNPJ: row.customer?.cnpj_cpf ?? '',
      Tipo: isConsolidatedInvoice(row) ? 'Consolidada' : 'Único BL',
      Status: invoiceStatusLabel(row.status),
      Emissao: row.issued_at ? formatDate(row.issued_at) : '',
      DataPagamento: getInvoicePaymentDate(row) ? formatDate(getInvoicePaymentDate(row)) : '',
      QtdBLs: bls.length,
      BLs: bls.map((bl) => bl.bl_id).join(' • '),
      Navio: navios,
      Viagem: viagens,
      POD: pods,
      TotalBRL: Number(row.total_brl ?? 0),
      PagoBRL: Number(row.total_paid_brl ?? 0),
      SaldoBRL: Number(row.balance_brl ?? 0),
    }
  })

  const blRows = rows.flatMap((row) =>
    getInvoiceBls(row).map((bl) => ({
      Fatura: row.invoice_number ?? `INV-${row.id}`,
      Cliente: row.customer?.name ?? '',
      CNPJ: row.customer?.cnpj_cpf ?? '',
      Tipo: isConsolidatedInvoice(row) ? 'Consolidada' : 'Único BL',
      BL: bl.bl_id,
      Navio: bl.vessel_name ?? '',
      Viagem: bl.voyage_number ?? '',
      POD: bl.pod ?? '',
      Emissao: row.issued_at ? formatDate(row.issued_at) : '',
      DataPagamento: getInvoicePaymentDate(row) ? formatDate(getInvoicePaymentDate(row)) : '',
      Status: invoiceStatusLabel(row.status),
      TotalBRL: Number(row.total_brl ?? 0),
      PagoBRL: Number(row.total_paid_brl ?? 0),
      SaldoBRL: Number(row.balance_brl ?? 0),
    })),
  )

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, toSheet(XLSX, invoiceRows), 'Faturas')
  XLSX.utils.book_append_sheet(workbook, toSheet(XLSX, blRows), 'BLs')
  XLSX.writeFile(workbook, `faturas-${makeTimestamp()}.xlsx`)
}

export async function exportLocalChargeOperationsWorkbook(rows: LocalChargeOperationalRow[]) {
  const XLSX = await import('@e965/xlsx')
  const exportRows = rows.map((row) => ({
    BL: row.id,
    Modalidade: row.cargo_mode === 'carga_solta' ? 'Carga Solta' : 'Container',
    Navio: row.voyage?.vessel?.name ?? '',
    Viagem: row.voyage?.voyage_number ?? '',
    POL: row.pol ?? '',
    POD: row.pod ?? '',
    Cliente: row.customer?.name ?? '',
    CNPJ: row.customer?.cnpj_cpf ?? '',
    StatusTaxas: row.charge_status ?? '',
    Linhas: row.totals.line_count,
    LinhasRevisao: row.totals.review_required_count,
    SubtotalBRL: Number(row.totals.total_brl ?? 0),
    SubtotalUSD: Number(row.totals.total_usd ?? 0),
    CalculadoEm: row.charges_calculated_at ?? '',
    RevisadoEm: row.charges_reviewed_at ?? '',
    Isencao: row.charge_exemption_reason ?? '',
    UltimoEventoEm: row.trail.last_event_at ?? '',
    UltimoEventoPor: row.trail.last_event_by ?? '',
    UltimoEvento: row.trail.last_event_field ?? '',
    UltimaMensagem: row.trail.last_event_message ?? '',
  }))

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, toSheet(XLSX, exportRows), 'TaxasLocais')
  XLSX.writeFile(workbook, `taxas-locais-${makeTimestamp()}.xlsx`)
}

export async function exportOperationalReportWorkbook(rows: OperationalReportRow[]) {
  const XLSX = await import('@e965/xlsx')
  const exportRows = rows.map((row) => ({
    BL: row.id,
    Modalidade: row.cargo_mode === 'carga_solta' ? 'Carga Solta' : 'Container',
    Armador: row.voyage?.vessel?.carrier?.name ?? '',
    Navio: row.voyage?.vessel?.name ?? '',
    Viagem: row.voyage?.voyage_number ?? '',
    POL: row.pol ?? '',
    POD: row.pod ?? '',
    Cliente: row.customer?.name ?? '',
    CNPJ: row.customer?.cnpj_cpf ?? '',
    Containers: (row.bl_containers ?? []).length,
    PesoKg: Number(row.total_weight_kg ?? 0),
    CBM: Number(row.total_cbm ?? 0),
    Revisao: row.review_status ?? '',
    Financeiro: row.financial_status ?? '',
    CriadoEm: row.created_at ?? '',
  }))

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, toSheet(XLSX, exportRows), 'Operacional')
  XLSX.writeFile(workbook, `relatorio-operacional-${makeTimestamp()}.xlsx`)
}

export async function exportFinancialReportWorkbook(rows: FinancialReportRow[]) {
  const XLSX = await import('@e965/xlsx')
  const exportRows = rows.map((row) => ({
    Invoice: row.invoice_number ?? `INV-${row.id}`,
    Cliente: row.customer?.name ?? '',
    CNPJ: row.customer?.cnpj_cpf ?? '',
    Emissao: row.issued_at ?? '',
    Vencimento: row.due_date ?? '',
    TotalBRL: Number(row.total_brl ?? 0),
    SaldoBRL: Number(row.balance_brl ?? 0),
    Status: row.status ?? '',
  }))

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, toSheet(XLSX, exportRows), 'Financeiro')
  XLSX.writeFile(workbook, `relatorio-financeiro-${makeTimestamp()}.xlsx`)
}

export async function exportCustomerReportWorkbook(rows: CustomerReportRow[]) {
  const XLSX = await import('@e965/xlsx')
  const exportRows = rows.map((row) => ({
    Cliente: row.name,
    CNPJ: row.cnpj_cpf,
    BLs: row.blCount,
    PesoTotalKg: row.totalWeightKg,
    CBMTotal: row.totalCbm,
    Invoices: row.invoiceCount,
    TotalEmitidoBRL: row.totalIssued,
    SaldoPendenteBRL: row.totalBalance,
  }))

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, toSheet(XLSX, exportRows), 'Clientes')
  XLSX.writeFile(workbook, `relatorio-clientes-${makeTimestamp()}.xlsx`)
}

export async function exportCustomerBaseWorkbook(rows: CustomerListItem[]) {
  const XLSX = await import('@e965/xlsx')
  const exportRows = rows.map((row) => ({
    'CNPJ/CPF': row.cnpj_cpf ?? '',
    'Razao Social': row.name ?? '',
    'Nome Fantasia': row.trade_name ?? '',
    Email: '',
    Endereco: row.address ?? '',
    Cidade: row.city ?? '',
    UF: row.state ?? '',
    CEP: row.zip ?? '',
  }))

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, toSheet(XLSX, exportRows), 'BaseClientes')
  XLSX.writeFile(workbook, `base-clientes-${makeTimestamp()}.xlsx`)
}

export async function exportVaziosImportacaoWorkbook(rows: VaziosImportacaoContainerListItem[]) {
  const XLSX = await import('@e965/xlsx')
  const exportRows = rows.map((row) => {
    const manifestLabel = row.manifest?.description
      ? row.manifest.description
      : row.manifest?.imported_at
        ? formatDate(row.manifest.imported_at)
        : ''

    return {
      Container: row.container_number,
      Tipo: row.container_type ?? '',
      'Tara (kg)': row.tare_kg ?? '',
      POD: row.pod ?? '',
      Navio: row.manifest?.voyage?.vessel?.name ?? '',
      Viagem: row.manifest?.voyage?.voyage_number ?? '',
      Manifesto: manifestLabel,
      'Importado em': row.manifest?.imported_at ? formatDate(row.manifest.imported_at) : '',
    }
  })

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, toSheet(XLSX, exportRows), 'VaziosImportacao')
  XLSX.writeFile(workbook, `vazios-importacao-${makeTimestamp()}.xlsx`)
}

export async function exportBaplieWorkbook(rows: BaplieContainer[]) {
  const XLSX = await import('@e965/xlsx')
  const exportRows = rows.map((row) => ({
    Container: row.container_number,
    Status: row.status === 'empty' ? 'Vazio' : row.status === 'full' ? 'Cheio' : (row.status ?? ''),
    Tipo: row.size_type ?? '',
    POL: row.pol ?? '',
    POD: row.pod ?? '',
    Slot: row.slot ?? '',
    'B/L ref': row.bl_ref ?? '',
    'Destino final': row.final_dest ?? '',
    Perfil: row.is_imo ? 'IMO' : row.is_oog ? 'OOG' : 'Padrao',
    IMO: row.is_imo ? 'SIM' : 'NAO',
    'Classe IMO': row.imo_class ?? '',
    'UN Number': row.un_number ?? '',
    OOG: row.is_oog ? 'SIM' : 'NAO',
    'Peso (kg)': row.weight_kg ?? '',
    'Importado em': row.imported_at ? formatDate(row.imported_at) : '',
  }))

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, toSheet(XLSX, exportRows), 'Baplie EDI')
  XLSX.writeFile(workbook, `baplie-edi-${makeTimestamp()}.xlsx`)
}

// --- Portal do cliente ---------------------------------------------------
// Exportacoes do portal espelham as colunas exibidas nas telas, escopadas ao
// cliente autenticado. Sempre .xlsx, nunca CSV.

export async function exportPortalLocalInvoicesWorkbook(rows: PortalInvoiceSummary[]) {
  const XLSX = await import('@e965/xlsx')
  const exportRows = rows.map((row) => ({
    'B/L': (row.bls ?? []).join(' • '),
    Fatura: row.invoice_number ?? `INV-${row.id}`,
    Tipo: row.invoice_type === 'consolidated' ? 'Consolidada' : 'Individual',
    'Navio/Viagem': (row.vessel_voyages ?? []).join(' / '),
    POD: (row.pods ?? []).join(' / '),
    Emissao: row.issued_at ? formatDate(row.issued_at) : '',
    Pagamento: row.due_date ? formatDate(row.due_date) : '',
    TotalBRL: Number(row.total_brl ?? 0),
    PagoBRL: Number(row.total_paid_brl ?? 0),
    SaldoBRL: Number(row.balance_brl ?? 0),
    Status: row.status ?? '',
  }))

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, toSheet(XLSX, exportRows), 'TaxasLocais')
  XLSX.writeFile(workbook, `faturas-taxas-locais-${makeTimestamp()}.xlsx`)
}

export async function exportPortalDemurrageWorkbook(rows: PortalDemurrageInvoice[]) {
  const XLSX = await import('@e965/xlsx')
  const exportRows = rows.map((row) => ({
    Documento: row.doc_number,
    'B/L': row.bl_id,
    'Navio/Viagem': [row.vessel_name, row.voyage_number].filter(Boolean).join(' / '),
    POL: row.pol ?? '',
    POD: row.pod ?? '',
    Emissao: formatDate(row.billed_at ?? row.doc_date) ?? '',
    Vencimento: formatDate(row.due_date) ?? '',
    TotalUSD: Number(row.total_usd ?? 0),
    TotalBRL: row.frozen_total_brl != null ? Number(row.frozen_total_brl) : '',
    Status: row.status ?? '',
  }))

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, toSheet(XLSX, exportRows), 'Demurrage')
  XLSX.writeFile(workbook, `faturas-demurrage-${makeTimestamp()}.xlsx`)
}

export async function exportPortalBlsWorkbook(rows: PortalOperationBL[]) {
  const XLSX = await import('@e965/xlsx')
  const exportRows = rows.map((row) => ({
    'B/L': row.bl_id,
    'CE Mercante': row.ce_mercante ?? '',
    Navio: row.vessel_name ?? '',
    Viagem: row.voyage_number ?? '',
    POL: row.pol ?? '',
    POD: row.pod ?? '',
    Containers: row.container_count,
    Devolvidos: row.containers_returned,
    'Sem devolucao': row.container_count - row.containers_returned,
    'Em demurrage': row.containers_in_demurrage,
  }))

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, toSheet(XLSX, exportRows), 'BLs')
  XLSX.writeFile(workbook, `bls-${makeTimestamp()}.xlsx`)
}

export async function exportPortalContainersWorkbook(rows: PortalFlatContainer[]) {
  const XLSX = await import('@e965/xlsx')
  const exportRows = rows.map((row) => ({
    Container: row.container_number,
    Tipo: row.type ?? '',
    'B/L': row.bl_id,
    'CE Mercante': row.ce_mercante ?? '',
    Navio: row.vessel_name ?? '',
    Viagem: row.voyage_number ?? '',
    POL: row.pol ?? '',
    POD: row.pod ?? '',
    Descarga: formatDate(row.discharge_date) ?? '',
    Devolucao: row.return_date ? formatDate(row.return_date) : '',
    'Dias de uso': row.usage_days ?? '',
    'Free time': row.free_time_days ?? '',
    'Dias em demurrage': row.demurrage_days ?? '',
    Status: row.status,
  }))

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, toSheet(XLSX, exportRows), 'Containers')
  XLSX.writeFile(workbook, `containers-${makeTimestamp()}.xlsx`)
}

function makeTimestamp() {
  const now = new Date()
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ]
  return parts.join('')
}
