// Leitura do texto livre de carga solta: descrição de mercadoria, contagem de
// máquinas e linhas de parte (shipper/consignee/notify). Extraído de
// breakbulkManifestParser.ts quando a importação de B/L avulso passou a
// precisar exatamente das mesmas regras — a fonte é a mesma (o texto que o
// armador escreve no B/L), então a regra tem de ser uma só.
import { extractNcmCodes } from '../lib/ncm'
import { toNumber } from '../lib/utils'

const MACHINE_KEYWORD_PATTERN =
  /\b(?:EXCAVATORS?|BUS(?:ES)?|MOBILE CRANES?|CRANES?|MOBILE JAW CRUSHERS?|JAW CRUSHERS?|CRUSHERS?|BULLDOZERS?|WHEEL LOADERS?|LOADERS?|FORKLIFTS?|DUMP TRUCKS?|TRUCKS?|CONVEYORS?|GRADERS?|ROLLERS?|TRACTORS?|DRILLING RIGS?)\b/

const MACHINE_IDENTIFIER_PATTERN =
  /\b(?:CHASSIS|VIN|ENGINE|FRAME|SERIAL|PRODUCT\s*ID|MACHINE\s*NO|EQUIPMENT\s*NO)\b/

const MACHINE_NCM_PREFIXES = [
  '8426', // guindastes, pontes rolantes e equipamentos de elevacao.
  '8427', // empilhadeiras, plataformas e veiculos de movimentacao.
  '8428', // outros equipamentos de elevacao, carga, descarga e movimentacao.
  '8429', // tratores de esteira, escavadeiras, pa carregadeiras e similares.
  '8430', // maquinas de terraplenagem, perfuracao e compactacao.
  '8474', // britadores, peneiras e maquinas para minerais.
  '8479', // maquinas e aparelhos mecanicos com funcao propria.
  '8702', // onibus e veiculos para transporte de passageiros.
  '8704', // caminhoes e veiculos para transporte de carga.
  '8705', // veiculos automoveis para usos especiais.
]

/** Quantidade de máquinas declarada na descrição da carga, quando houver. */
export function extractCarrierMachineQty(value: string) {
  const normalized = value.toUpperCase()
  const hasMachineIdentifier = MACHINE_IDENTIFIER_PATTERN.test(normalized)
  const hasMachineNcm = extractMachineNcmCodes(value).length > 0
  const total = value
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((sum, line) => sum + extractCarrierMachineQtyFromLine(line, hasMachineIdentifier || hasMachineNcm), 0)

  if (total > 0) return total

  const identifierCount = hasMachineNcm ? countMachineModelIdentifiers(value) : 0
  return identifierCount > 0 ? identifierCount : null
}

function extractCarrierMachineQtyFromLine(value: string, hasMachineIdentifier: boolean) {
  const line = value.toUpperCase().replace(/\s+/g, ' ')
  const hasMachineKeyword = MACHINE_KEYWORD_PATTERN.test(line)
  if (!hasMachineKeyword && !hasMachineIdentifier) return 0

  const unitMatch = line.match(/(?:^|\D)(\d+(?:[.,]\d+)?)\s+(?:UNITS?|MACHINES?)\b/)
  if (unitMatch) return toNumber(unitMatch[1]) ?? 0

  if (!hasMachineKeyword) return 0

  const directEquipmentMatch = line.match(
    new RegExp(`(?:^|\\D)(\\d+(?:[.,]\\d+)?)\\s+(?:${MACHINE_KEYWORD_PATTERN.source})\\b`),
  )
  return directEquipmentMatch ? toNumber(directEquipmentMatch[1]) ?? 0 : 0
}

function extractMachineNcmCodes(value: string) {
  return extractNcmCodes(value).filter((code) => MACHINE_NCM_PREFIXES.some((prefix) => code.startsWith(prefix)))
}

function countMachineModelIdentifiers(value: string) {
  const ignoredCodes = new Set(extractNcmCodes(value))
  const matches = Array.from(value.toUpperCase().matchAll(/\b[A-Z]{2,}\d{2,}[A-Z]*-\d{2,}\b/g))
    .map((match) => match[0])
    .filter((code) => !ignoredCodes.has(code.replace(/\D/g, '')))

  return new Set(matches).size
}

/** Descrição da carga em uma linha, sem as linhas de serviço do B/L. */
export function normalizeCarrierBreakbulkDescription(value: string) {
  const lines = value
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index) => !(index === 0 && /^\d+\s+.+$/i.test(line)))
    .filter((line) => !/^(FCL|LCL)\/(FCL|LCL)$/i.test(line))
    .filter((line) => !/^NET WEIGHT[:\s]/i.test(line))
    .filter((line) => !/^NCM NUMBER[:\s]/i.test(line))
    .filter((line) => !/^WOODEN PACKAGE[:\s]/i.test(line))
    .filter((line) => !/FREE TIME/i.test(line))

  return lines.join(' | ')
}

/** Primeira linha de um bloco de parte que é nome, e não documento ou contato. */
export function firstMeaningfulPartyLine(value: string) {
  return (
    value
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean)
      .find(
        (line) =>
          !/^(SAME AS CONSIGNEE|CNPJ[:\s]|TAX ID[:\s]|TEL[:\s]|PHONE[:\s]|FAX[:\s]|EMAIL[:\s]|E-MAIL[:\s])/i.test(line),
      ) ?? ''
  )
}

/** Heurística de linha que nomeia uma empresa (e não endereço/contato). */
export function isLikelyCompanyLine(value: string) {
  const line = value.trim()
  if (!line) return false
  if (/@/.test(line)) return false
  if (/^(TEL|PHONE|FAX|MOBILE|CEP|ZIP|RUA|ROAD|NO\.|ROOM|VIA\b|POLO\b|CITY\b|STATE\b|COUNTRY\b)/i.test(line)) return false
  if (/^CNPJ[:\s]/i.test(line)) return false
  if (
    /\d{4,}/.test(line) &&
    !/(LTDA|LTD|S\.A|S\/A|CO\., LTD|COMERCIO|INDUSTRIA|SERVICOS|LOGISTICA|TRANSPORTES|TRADING|IMPORTACAO|EXPORTACAO|QUIMICA)/i.test(
      line,
    )
  ) {
    return false
  }

  return /(LTDA|LTD|S\.A|S\/A|CO\., LTD|COMERCIO|INDUSTRIA|SERVICOS|LOGISTICA|TRANSPORTES|TRADING|IMPORTACAO|EXPORTACAO|QUIMICA|FLOCCULANT)/i.test(
    line,
  )
}
