import type { BL, BLContainer, Voyage, Vessel, Port } from '../types/database'

export type MercanteManifestData = {
  shippingCompanyCode: string
  agencyCnpj: string
  voyageNumber: string
  vesselImo: string
  polLocode: string
  podLocode: string
  terminalCode: string
  operationDate: string
  closingDate: string
  bls: MercanteBlData[]
}

export type MercanteBlData = {
  blNumber: string
  consigneeCnpjCpf: string
  consigneeName: string
  consigneeAddress: string
  shipperName: string
  shipperAddress: string
  cargoDescription: string
  totalPackages: number
  totalWeightKg: number
  totalCbm: number
  containers: MercanteContainerData[]
}

export type MercanteContainerData = {
  containerNumber: string
  sealNumber: string
  containerType: string
  tareWeightKg: number
  grossWeightKg: number
  totalCbm: number
  ncmCodes: string[]
  isImo: boolean
  imoClass: string
  unNumber: string
}

function fmtAlfa(value: string, length: number): string {
  return value.slice(0, length).padEnd(length, ' ')
}

function fmtNum(value: number | string, length: number): string {
  const str = typeof value === 'number' ? String(Math.round(value)) : value.replace(/\D/g, '')
  return str.slice(0, length).padStart(length, '0')
}

function fmtDate(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 8) {
    if (value.includes('-')) {
      return digits.substring(6, 8) + digits.substring(4, 6) + digits.substring(0, 4)
    }
    return digits
  }
  return digits.substring(6, 8) + digits.substring(4, 6) + digits.substring(0, 4)
}

function fmtNumDec(value: number, length: number, decimals: number): string {
  const mult = 10 ** decimals
  const intVal = Math.round(value * mult)
  return String(intVal).padStart(length, '0')
}

export function generateM5Record(data: MercanteManifestData): string {
  const qtdeCe = fmtNum(data.bls.length, 4)
  const qtdeVazio = fmtAlfa('', 4)
  const empNav = fmtAlfa(data.shippingCompanyCode, 14)
  const agenNav = fmtAlfa(data.agencyCnpj, 14)
  const encManif = fmtDate(data.closingDate)
  const descarga = fmtDate(data.operationDate)
  const portoOrig = fmtAlfa(data.polLocode, 5)
  const portoDest = fmtAlfa(data.podLocode, 5)
  const viagem = fmtAlfa(data.voyageNumber, 10)
  const imo = fmtAlfa(data.vesselImo, 10)
  const termCarr = fmtAlfa(data.terminalCode, 40)
  const nrManifesto = fmtAlfa(data.bls[0]?.blNumber ?? '', 10)
  const espacos = fmtAlfa('', 10)
  const filler = fmtAlfa('', 20)

  return `M5${qtdeCe}${qtdeVazio}${empNav}${agenNav}${encManif}${descarga}${portoOrig}${portoDest}${viagem}${imo}${termCarr}${nrManifesto}${espacos}${filler}`
}

export function generateC5Record(bl: MercanteBlData): string {
  // ponytail: modelo real define 4104 chars por registro C5
  let record = ''
  record += 'C5'
  record += fmtNum(bl.containers.length, 4)
  record += fmtAlfa(bl.blNumber, 18)
  record += fmtAlfa('N', 1)
  record += fmtAlfa('N', 1)
  record += fmtAlfa('', 2)
  record += fmtAlfa('N', 1)
  record += fmtAlfa(bl.consigneeName + (bl.consigneeAddress ? ' - ' + bl.consigneeAddress : ''), 253)
  record += fmtAlfa('', 30)
  record += fmtAlfa('', 55)
  record += fmtAlfa(bl.consigneeCnpjCpf, 14)
  record += fmtAlfa(bl.shipperName, 253)
  record += fmtAlfa('', 8)
  record += fmtAlfa(bl.cargoDescription, 253)
  record += fmtAlfa('', 506)
  record += fmtAlfa('', 10)
  record += fmtAlfa('', 3)
  record += fmtAlfa('', 10)
  record += fmtAlfa(bl.consigneeCnpjCpf, 14)
  record += fmtAlfa(bl.consigneeName, 253)
  record += fmtAlfa('', 44)
  record += fmtAlfa('', 4)
  record += fmtAlfa('', 16)
  record += fmtAlfa('', 10)
  record += fmtAlfa('', 10)
  record += fmtAlfa('', 10)
  record += fmtAlfa('', 10)
  record += fmtAlfa('', 2001)
  record += fmtAlfa('', 10)
  record += fmtAlfa('', 10)
  record += fmtAlfa('', 10)
  record += fmtAlfa('', 3)
  for (let i = 0; i < 13; i++) {
    record += fmtAlfa('', 20)
  }
  record += fmtAlfa('', 15)
  return record
}

export function generateI5Record(
  container: MercanteContainerData,
  seq: number,
): string {
  // ponytail: modelo real define 5000 chars por registro I5
  let record = ''
  record += 'I5'
  record += fmtAlfa('1', 1)
  record += fmtNum(seq, 4)
  record += fmtNumDec(container.grossWeightKg, 12, 3)
  record += fmtAlfa(container.containerType, 4)
  record += fmtAlfa(container.containerNumber, 11)
  record += fmtNumDec(container.tareWeightKg, 9, 3)
  record += fmtNumDec(container.totalCbm ?? 0, 11, 3)
  record += fmtAlfa('', 393)
  if (container.isImo) {
    record += ' '
    record += '00'
    record += fmtNum(container.unNumber, 4)
    record += fmtAlfa(container.imoClass, 1)
  } else {
    record += fmtAlfa('', 8)
  }
  record += fmtAlfa('', 3)
  record += '00'
  record += fmtAlfa('', 10)
  record += fmtAlfa('', 10)
  record += fmtAlfa('', 50)
  record += fmtAlfa('', 1)
  record += fmtAlfa(container.ncmCodes[0] ?? '', 4)
  record += fmtAlfa('', 5)
  record += fmtAlfa('', 4460)
  return record
}

export function generateEdiMercante(data: MercanteManifestData): string {
  const lines: string[] = []
  lines.push(generateM5Record(data))

  for (const bl of data.bls) {
    lines.push(generateC5Record(bl))
    bl.containers.forEach((ctr, idx) => {
      lines.push(generateI5Record(ctr, idx + 1))
    })
  }

  return lines.join('\r\n')
}

export function blToMercanteBlData(bl: BL, containers: BLContainer[]): MercanteBlData {
  return {
    blNumber: bl.id,
    consigneeCnpjCpf: bl.manifest_customer_cnpj_cpf ?? '',
    consigneeName: bl.manifest_customer_name ?? bl.consignee ?? '',
    consigneeAddress: '',
    shipperName: bl.shipper ?? '',
    shipperAddress: '',
    cargoDescription: bl.cargo_description ?? '',
    totalPackages: 0,
    totalWeightKg: bl.total_weight_kg ?? 0,
    totalCbm: bl.total_cbm ?? 0,
    containers: containers.map((c) => ({
      containerNumber: c.container_number,
      sealNumber: c.seal_number ?? '',
      containerType: c.type ?? '',
      tareWeightKg: c.tare_weight_kg ?? 0,
      grossWeightKg: c.gross_weight_kg ?? 0,
      totalCbm: 0,
      ncmCodes: [],
      isImo: c.is_imo ?? false,
      imoClass: c.imo_class ?? '',
      unNumber: c.un_number ?? '',
    })),
  }
}

export function buildManifestData(params: {
  shippingCompanyCode: string
  agencyCnpj: string
  terminalCode: string
  emissionDate: string
  voyage: Voyage
  vessel: Vessel
  polPort: Port | null
  podPort: Port | null
  bls: BL[]
  blContainers: Map<string, BLContainer[]>
}): MercanteManifestData {
  const blData = params.bls.map((bl) =>
    blToMercanteBlData(bl, params.blContainers.get(bl.id) ?? []),
  )

  return {
    shippingCompanyCode: params.shippingCompanyCode,
    agencyCnpj: params.agencyCnpj,
    voyageNumber: params.voyage.voyage_number,
    vesselImo: params.vessel.imo ?? '',
    polLocode: params.polPort?.locode ?? '',
    podLocode: params.podPort?.locode ?? '',
    terminalCode: params.terminalCode,
    operationDate: params.emissionDate,
    closingDate: params.emissionDate,
    bls: blData,
  }
}
