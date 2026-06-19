import { describe, expect, it } from 'vitest'
import { buildCntrManifestImportSummary } from '../voyageImportSummary'
import type { ParsedManifest } from '../../../services/manifestParser'

function manifest(bls: ParsedManifest['bls']): ParsedManifest {
  return { bls, rowErrors: [], manifest_etd: null }
}

describe('buildCntrManifestImportSummary', () => {
  it('resume manifestos por arquivo e soma containers distintos no consolidado', () => {
    const summary = buildCntrManifestImportSummary([
      {
        filename: 'alpha.xlsx',
        preview: manifest([
          {
            id: 'BL1',
            shipper: null,
            consignee: null,
            notify_party: null,
            cargo_description: null,
            cnpj_cpf: null,
            pol: 'CNTAC',
            pod: 'BRVIT',
            total_weight_kg: null,
            total_cbm: null,
            review_status: 'ok',
            review_reasons: [],
            containers: [
              { container_number: 'ABCD1234567', seal_number: null, type: null, gross_weight_kg: null, cbm: null, is_oog: false, is_imo: false, imo_class: null, un_number: null },
              { container_number: 'EFGH1234567', seal_number: null, type: null, gross_weight_kg: null, cbm: null, is_oog: false, is_imo: false, imo_class: null, un_number: null },
            ],
          },
        ]),
      },
      {
        filename: 'beta.xlsx',
        preview: manifest([
          {
            id: 'BL2',
            shipper: null,
            consignee: null,
            notify_party: null,
            cargo_description: null,
            cnpj_cpf: null,
            pol: 'CNTAC',
            pod: 'BRSSZ',
            total_weight_kg: null,
            total_cbm: null,
            review_status: 'ok',
            review_reasons: [],
            containers: [
              { container_number: 'ABCD1234567', seal_number: null, type: null, gross_weight_kg: null, cbm: null, is_oog: false, is_imo: false, imo_class: null, un_number: null },
            ],
          },
        ]),
      },
    ])

    expect(summary.rows).toEqual([
      { filename: 'alpha.xlsx', pol: 'CNTAC', pod: 'BRVIT', blCount: 1, containerCount: 2 },
      { filename: 'beta.xlsx', pol: 'CNTAC', pod: 'BRSSZ', blCount: 1, containerCount: 1 },
    ])
    expect(summary.totalDistinctContainers).toBe(2)
  })
})
