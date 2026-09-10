import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }))

vi.mock('../supabase', () => ({
  supabase: { rpc: mockRpc },
}))

import { getOperationalBlSummary, listOperationalVoyageSummaries } from '../operationalLists'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/035_operational_voyage_summaries.sql'),
  'utf8',
)
const summaryMetricsMigration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/036_operational_breakbulk_summary_metrics.sql'),
  'utf8',
)

describe('lista resumida de viagens', () => {
  beforeEach(() => mockRpc.mockReset())

  it('chama a RPC com paginação e normaliza o envelope do read-model', async () => {
    mockRpc.mockResolvedValue({
      data: {
        rows: [{
          id: 7,
          voyage_number: 'V-7',
          status: 'active',
          bl_count: '12',
          container_count: '8',
          ce_filled: '10',
          ce_total: '12',
          routes: [{ pol: 'CNSHA', pod: 'BRVIX', bl_count: '12' }],
        }],
        count: '1',
      },
      error: null,
    })

    await expect(listOperationalVoyageSummaries(2, 100)).resolves.toEqual({
      rows: [{
        id: 7,
        voyage_number: 'V-7',
        status: 'active',
        etd: null,
        eta: null,
        ata: null,
        created_at: null,
        vessel: null,
        pol: null,
        pod: null,
        blCount: 12,
        containerBlCount: 0,
        breakbulkBlCount: 0,
        containerCount: 8,
        baplieCount: 0,
        ceCoverage: { filled: 10, total: 12 },
        routes: [{
          pol: 'CNSHA',
          pod: 'BRVIX',
          blCount: 12,
          containerBlCount: 0,
          breakbulkBlCount: 0,
          ceFilled: 0,
          ceTotal: 12,
        }],
      }],
      count: 1,
    })
    expect(mockRpc).toHaveBeenCalledWith('operational_list_voyage_summaries', {
      p_page: 2,
      p_page_size: 100,
    })
  })

  it('normaliza as métricas de carga solta do resumo server-side', async () => {
    mockRpc.mockResolvedValue({
      data: {
        totalBls: '2',
        totalDistinctContainers: '0',
        pendingReview: '1',
        pendingFinancial: '2',
        chargePending: '1',
        chargeReady: '0',
        chargeExempt: '0',
        totalMachines: '3',
        totalPackages: '48',
        totalWeightTon: '2.75',
        totalCbm: '12.5',
      },
      error: null,
    })

    await expect(getOperationalBlSummary({ cargoMode: 'carga_solta' })).resolves.toMatchObject({
      totalBls: 2,
      totalMachines: 3,
      totalPackages: 48,
      totalWeightTon: 2.75,
      totalCbm: 12.5,
    })
    expect(mockRpc).toHaveBeenCalledWith('operational_list_bl_summary', expect.objectContaining({
      p_cargo_mode: 'carga_solta',
    }))
  })
})

describe('migration 035 — resumo operacional de viagens', () => {
  it('agrega rotas e métricas no servidor e limita a página', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.operational_list_voyage_summaries\(/i)
    expect(migration).toMatch(/jsonb_agg\([\s\S]*routes/i)
    expect(migration).toMatch(/COUNT\(DISTINCT[\s\S]*container_number/i)
    expect(migration).toMatch(/OFFSET[\s\S]*LIMIT/i)
    expect(migration).not.toMatch(/SELECT\s+v\.\*/i)
  })

  it('mantém a leitura autenticada e revoga a superfície pública', () => {
    expect(migration).toMatch(/SECURITY INVOKER/i)
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.operational_list_voyage_summaries\([\s\S]*FROM PUBLIC, anon/i)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.operational_list_voyage_summaries\([\s\S]*TO authenticated/i)
  })
})

describe('migration 036 — métricas de carga solta', () => {
  it('preserva a assinatura e calcula o envelope sem selecionar B/Ls no browser', () => {
    expect(summaryMetricsMigration).toMatch(/CREATE OR REPLACE FUNCTION public\.operational_list_bl_summary\(/i)
    expect(summaryMetricsMigration).toMatch(/totalMachines/i)
    expect(summaryMetricsMigration).toMatch(/totalPackages/i)
    expect(summaryMetricsMigration).toMatch(/totalWeightTon/i)
    expect(summaryMetricsMigration).toMatch(/totalCbm/i)
    expect(summaryMetricsMigration).toMatch(/REVOKE ALL ON FUNCTION/i)
  })
})
