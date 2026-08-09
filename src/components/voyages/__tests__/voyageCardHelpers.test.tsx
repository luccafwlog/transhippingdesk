import { MemoryRouter } from 'react-router-dom'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { VoyageBl } from '../../../services/voyageSummaries'
import { buildVoyagePolEntityId } from '../../../services/voyageRouteSchedules'
import { VoyageManifestosTab } from '../VoyageManifestosTab'
import { buildVoyageRouteLegs, collectVoyageManifestBatchRows, formatPolDeparture, type VoyageImportBatch } from '../voyageCardHelpers'
import type { Voyage } from '../voyageCardTypes'

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

describe('formatPolDeparture', () => {
  it('retorna ATD como data real quando existe', () => {
    expect(formatPolDeparture('2026-07-15', '2026-07-16')).toEqual({ value: '2026-07-16', isActual: true })
  })

  it('retorna ETD quando ATD nao existe sem quebrar com nulos', () => {
    expect(formatPolDeparture('2026-07-15', null)).toEqual({ value: '2026-07-15', isActual: false })
    expect(formatPolDeparture(null, null)).toEqual({ value: null, isActual: false })
  })
})

describe('VoyageManifestosTab', () => {
  it('mantem o titulo ETD e destaca ATD em verde quando conhecido', () => {
    const voyage = {
      id: 14,
      voyage_number: '001',
      vessel: { name: 'ALPHA' },
      bls: [makeBl({ id: 'BL-001', ce_mercante: 'CE-001' })],
    } as Voyage

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <VoyageManifestosTab
          voyage={voyage}
          voyageLabel="ALPHA / 001"
          importBatches={[]}
          polSchedules={new Map([
            [buildVoyagePolEntityId(14, 'CNTAC'), { entityId: '14::CNTAC', voyageId: 14, pol: 'CNTAC', etd: '2026-07-15', atd: '2026-07-16', escalaNumber: null }],
          ])}
          routeCeMasters={undefined}
          divergenceCount={0}
          ceCoverage={{ filled: 1, total: 1 }}
          estadoMeta={{ color: '#1f7a4d', bg: '#eef8f1', label: 'OK' }}
          onEditPol={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(html).toContain('<th scope="col" class="px-3 py-2">ATD POL</th>')
    expect(html).not.toContain('15/07/2026')
    expect(html).toContain('16/07/2026')
    expect(html).toContain('style="color:#1f7a4d"')
    expect(html).toContain('font-medium')
    expect(html).not.toContain('Gerar EDI Mercante')
  })
})

describe('buildVoyageRouteLegs', () => {
  const escalas = [
    { port: 'BRSSA', temImportacao: true, temExportacao: false },
    { port: 'BRVIX', temImportacao: true, temExportacao: true },
  ]

  it('separa a perna de importação da de exportação', () => {
    const legs = buildVoyageRouteLegs({
      bls: [],
      fallbackPol: null,
      escalas,
      exportDischargePorts: [],
    })

    expect(legs.importLeg).toEqual({ originPorts: [], destinationPorts: ['BRSSA', 'BRVIX'] })
    expect(legs.exportLeg).toEqual({ originPorts: ['BRVIX'], destinationPorts: [] })
  })

  it('mantém só a perna de importação quando nenhuma escala embarca', () => {
    const legs = buildVoyageRouteLegs({
      bls: [{ pol: 'CNTAC', pod: 'BRSSA' }],
      fallbackPol: null,
      escalas: [escalas[0]],
      exportDischargePorts: [],
    })

    expect(legs.importLeg).toEqual({ originPorts: ['CNTAC'], destinationPorts: ['BRSSA'] })
    expect(legs.exportLeg).toBeNull()
  })

  it('não inventa perna de importação em viagem que só embarca', () => {
    const legs = buildVoyageRouteLegs({
      bls: [],
      fallbackPol: 'BRVIX',
      escalas: [{ port: 'BRVIX', temImportacao: false, temExportacao: true, dischargePorts: ['NLRTM'] }],
      exportDischargePorts: [],
    })

    expect(legs.importLeg).toBeNull()
    expect(legs.exportLeg).toEqual({ originPorts: ['BRVIX'], destinationPorts: ['NLRTM'] })
  })

  it('soma os portos de descarga do cadastro aos dos manifestos importados', () => {
    const legs = buildVoyageRouteLegs({
      bls: [],
      fallbackPol: null,
      escalas: [{ ...escalas[1], dischargePorts: ['NLRTM'] }],
      exportDischargePorts: ['ITGOA', null],
    })

    expect(legs.exportLeg).toEqual({ originPorts: ['BRVIX'], destinationPorts: ['ITGOA', 'NLRTM'] })
  })

  it('abre a perna de exportação só com o cadastro, antes de existir manifesto', () => {
    const legs = buildVoyageRouteLegs({
      bls: [{ pol: 'CNTAC', pod: 'BRSSA' }],
      fallbackPol: null,
      escalas: [escalas[0], { ...escalas[1], dischargePorts: ['NLRTM'] }],
      exportDischargePorts: [],
    })

    expect(legs.importLeg).toEqual({ originPorts: ['CNTAC'], destinationPorts: ['BRSSA', 'BRVIX'] })
    expect(legs.exportLeg).toEqual({ originPorts: ['BRVIX'], destinationPorts: ['NLRTM'] })
  })
})
