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
  if (digits.length === 8) return digits
  return digits.substring(6, 8) + digits.substring(4, 6) + digits.substring(0, 4)
}

const SEP = '    '

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
  const filler = fmtAlfa('', 16)

  return `M5${qtdeCe}${qtdeVazio}${empNav}${agenNav}${encManif}${descarga}${portoOrig}${portoDest}${viagem}${imo}${termCarr}${nrManifesto}${espacos}${filler}`
}

export function generateC5Record(bl: MercanteBlData): string {
  const qtdeVol = fmtNum(bl.totalPackages, 4)
  const consigDoc = fmtAlfa(bl.consigneeCnpjCpf, 14)
  const parts = [
    `C5${qtdeVol}`,
    consigDoc,
    bl.consigneeName,
    bl.consigneeAddress,
    bl.shipperName,
    bl.shipperAddress,
    bl.cargoDescription,
    String(bl.totalPackages),
    String(bl.totalWeightKg),
    bl.totalCbm > 0 ? bl.totalCbm.toFixed(3) : '0.000',
  ]
  return parts.join(SEP)
}

export function generateI5Record(container: MercanteContainerData, seq: number): string {
  const nrSeq = fmtNum(seq, 4)
  const type = fmtAlfa(container.containerType, 4)
  const tare = fmtNum(Math.round(container.tareWeightKg), 6)
  const grossWeight = fmtNum(Math.round(container.grossWeightKg), 7)
  const ncm = (container.ncmCodes[0] ?? '').padEnd(4)
  const parts = [
    `I5${nrSeq}`,
    container.containerNumber,
    container.sealNumber,
    type,
    tare,
    grossWeight,
    ncm,
  ]
  return parts.join(SEP)
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
    operationDate: new Date().toISOString().slice(0, 10),
    closingDate: new Date().toISOString().slice(0, 10),
    bls: blData,
  }
}
