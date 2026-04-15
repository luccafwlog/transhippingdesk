import { countDistinctContainerNumbers, countDistinctContainerNumbersBy } from '../lib/containerCounts'
import type { BLListItem, ContainerListItem } from '../types/database'
import type { LocalChargeOperationalRow } from './localCharges'

export async function exportManifestWorkbook(rows: BLListItem[]) {
  const XLSX = await import('xlsx')
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
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(manifestRows), 'Manifestos')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(containerRows), 'Containers')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(breakbulkRows), 'CargaSolta')
  XLSX.writeFile(workbook, `manifestos-${makeTimestamp()}.xlsx`)
}

export async function exportContainerWorkbook(rows: ContainerListItem[]) {
  const XLSX = await import('xlsx')
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
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(exportRows), 'Containers')
  XLSX.writeFile(workbook, `containers-${makeTimestamp()}.xlsx`)
}

export async function exportLocalChargeOperationsWorkbook(rows: LocalChargeOperationalRow[]) {
  const XLSX = await import('xlsx')
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
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(exportRows), 'TaxasLocais')
  XLSX.writeFile(workbook, `taxas-locais-${makeTimestamp()}.xlsx`)
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
