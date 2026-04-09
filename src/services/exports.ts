import { countDistinctContainerNumbers, countDistinctContainerNumbersBy } from '../lib/containerCounts'
import type { BLListItem, ContainerListItem } from '../types/database'

export async function exportManifestWorkbook(rows: BLListItem[]) {
  const XLSX = await import('xlsx')
  const manifestRows = rows.map((row) => ({
    BL: row.id,
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

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(manifestRows), 'Manifestos')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(containerRows), 'Containers')
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
