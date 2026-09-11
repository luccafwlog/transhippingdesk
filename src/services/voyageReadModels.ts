import type {
  VoyageBl,
  VoyageGraniteManifest,
  VoyageVaziosManifest,
} from './voyageSummaries'

export type VoyageImportBatchDetail = {
  id: number
  voyage_id: number | null
  cargo_mode: 'container' | 'carga_solta' | null
  filename: string
  uploaded_at: string | null
  status: 'processing' | 'completed' | 'partial' | 'failed' | null
  total_bls: number | null
  ce_master: string | null
}

/** Payload completo usado somente pelo card da viagem selecionada. */
export type VoyageDetail = {
  id: number
  voyage_number: string
  etd: string | null
  eta: string | null
  ata: string | null
  status: string | null
  vessel?: {
    id: number
    name: string
    imo: string | null
    carrier?: { id: number; name: string; scac: string | null } | null
  } | null
  pol?: { id: number; name: string; locode: string | null; country: string | null } | null
  pod?: { id: number; name: string; locode: string | null; country: string | null } | null
  import_batches?: VoyageImportBatchDetail[] | null
  granite_manifests?: VoyageGraniteManifest[] | null
  vazios_manifests?: VoyageVaziosManifest[] | null
  bls: VoyageBl[]
}
