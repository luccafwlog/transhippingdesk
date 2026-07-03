import { describe, expect, it, vi } from 'vitest'
import type { VoyageBl } from '../../../pages/viagensHelpers'
import { collectVoyageManifestBatchRows, type VoyageImportBatch } from '../voyageCardHelpers'

vi.mock('../../../services/supabase', () => ({ supabase: {}, isSupabaseConfigured: true }))

function makeBl(overrides: Partial<VoyageBl> = {}): VoyageBl {
  return {
    id: 'BL-001',
    batch_id: null,
    cargo_mode: 'container',
    ce_mercante: null,
    bb_machine_qty: null,
    bb_packages_qty: null,
    bb_packages_total: null,
    bb_weight_ton: null,
    shipper: null,
    consignee: null,
    notify_party: null,
    pol: 'CNTAC',
    pod: 'BRVIX',
    total_weight_kg: null,
    total_cbm: null,
    bl_containers: null,
    bl_breakbulk_items: null,
    ...overrides,
  }
}

describe('collectVoyageManifestBatchRows', () => {
  it('deriva linhas de manifesto pelas rotas dos B/Ls mesmo sem batch', () => {
    const rows = collectVoyageManifestBatchRows({
      voyageId: 14,
      batches: [],
      bls: [
        makeBl({ id: 'BL-001', ce_mercante: 'CE-001' }),
        makeBl({ id: 'BL-002', ce_mercante: null }),
      ],
      polSchedules: new Map([['14::CNTAC', { etd: '2026-07-15' }]]),
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      routeKey: 'CNTAC__BRVIX',
      pol: 'CNTAC',
      pod: 'BRVIX',
      routeLabel: 'TAICANG -> BRVIX',
      modeLabel: 'CNTR',
      filenames: ['Rota derivada dos B/Ls'],
      batchIds: [],
      etd: '2026-07-15',
      blCount: 2,
      ceFilled: 1,
      ceTotal: 2,
      ceMaster: null,
    })
  })

  it('usa CE Master por rota como fallback quando a viagem so-B/L nao tem batch', () => {
    const rows = collectVoyageManifestBatchRows({
      voyageId: 14,
      batches: [],
      bls: [makeBl({ id: 'BL-001', ce_mercante: 'CE-001' })],
      routeCeMasters: new Map([['14::CNTAC__BRVIX', '25BR09999']]),
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ routeKey: 'CNTAC__BRVIX', batchIds: [], ceMaster: '25BR09999' })
  })

  it('soma B/Ls avulsos na mesma rota de um batch existente', () => {
    const batch: VoyageImportBatch = {
      id: 10,
      voyage_id: 14,
      cargo_mode: 'container',
      filename: 'manifesto-cntac-brvix.xlsx',
      uploaded_at: '2026-07-01T10:00:00Z',
      status: 'completed',
      total_bls: 1,
      ce_master: '25BR00481',
    }

    const rows = collectVoyageManifestBatchRows({
      voyageId: 14,
      batches: [batch],
      bls: [
        makeBl({ id: 'BL-001', batch_id: 10, ce_mercante: 'CE-001' }),
        makeBl({ id: 'BL-002', batch_id: null, ce_mercante: null }),
      ],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      routeKey: 'CNTAC__BRVIX',
      filenames: ['manifesto-cntac-brvix'],
      batchIds: [10],
      blCount: 2,
      ceFilled: 1,
      ceTotal: 2,
      ceMaster: '25BR00481',
    })
  })
})
