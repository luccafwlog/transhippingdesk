// Persistência do B/L avulso de carga solta. Não há caminho próprio: o
// documento vira um manifesto BB de uma linha e segue pela mesma RPC
// transacional do manifesto, com a mesma reconciliação de cliente, a mesma
// trilha de lote e o mesmo disparo de taxas locais.
import { canonicalizeVesselName } from '../lib/vesselAlias'
import { importBreakbulkManifest } from './breakbulkImport'
import { blDocumentToManifest, type ParsedBlDocument } from './blDocumentParser'

/** Viagem escolhida na tela, no formato que `useVoyageOptions` devolve. */
export type BlDocumentVoyage = {
  voyage_number: string
  vessel?: { name: string } | null
}

export async function importBlDocument({
  filename,
  voyageId,
  document,
  uploadedBy,
}: {
  filename: string
  voyageId: number
  document: ParsedBlDocument
  uploadedBy: string
}) {
  if (document.errors.length) {
    throw new Error(`${filename}: ${document.errors.join(' ')}`)
  }

  return importBreakbulkManifest({
    filename,
    voyageId,
    manifest: blDocumentToManifest(document),
    uploadedBy,
  })
}

/**
 * O B/L diz em que navio e viagem a carga embarcou; a viagem de destino é
 * escolhida na tela. Divergir é sinal de arquivo trocado, e a importação
 * documental de B/L de container já trata isso como bloqueio
 * (`blFreightImport.getDeclaredVoyageMismatchReason`) — carga solta segue o
 * mesmo contrato, inclusive no alias de prefixo do nome do navio.
 */
export function describeVoyageMismatch(document: ParsedBlDocument, voyage: BlDocumentVoyage | null) {
  if (!voyage || !document.vessel_name) return null

  const documentVessel = canonicalizeVesselName(document.vessel_name)
  const selectedVessel = canonicalizeVesselName(voyage.vessel?.name ?? '')
  const vesselMismatch = Boolean(selectedVessel) && documentVessel !== selectedVessel
  const voyageMismatch = Boolean(
    document.voyage_number &&
      voyage.voyage_number &&
      normalizeVoyageNumber(document.voyage_number) !== normalizeVoyageNumber(voyage.voyage_number),
  )

  if (!vesselMismatch && !voyageMismatch) return null

  return `Arquivo é da viagem ${formatVoyageRef(document.vessel_name, document.voyage_number)}, mas você apontou ${formatVoyageRef(voyage.vessel?.name, voyage.voyage_number)}.`
}

// "V.33", "33" e "033" são a mesma viagem no papel do armador.
function normalizeVoyageNumber(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '')
}

function formatVoyageRef(vessel?: string | null, voyage?: string | null) {
  const vesselLabel = String(vessel ?? '').trim() || 'Navio não informado'
  const voyageLabel = String(voyage ?? '').trim() || 'viagem não informada'
  return `${vesselLabel} / ${voyageLabel}`
}
