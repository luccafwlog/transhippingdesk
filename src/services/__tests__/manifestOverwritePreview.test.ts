import { describe, expect, it } from 'vitest'
import { computeManifestOverwriteDiff } from '../manifestOverwritePreview'

describe('computeManifestOverwriteDiff', () => {
  it('aponta os campos que o manifesto sobrescreveria num B/L existente', () => {
    const result = computeManifestOverwriteDiff(
      [{ id: 'BL1', consignee: 'NOVO CONSIGNEE', total_weight_kg: 20000 }],
      [{ id: 'BL1', consignee: 'ANTIGO CONSIGNEE', total_weight_kg: 18000 }],
    )
    expect(result).toEqual([
      {
        bl_number: 'BL1',
        diffs: [
          { field: 'Consignatário', from: 'ANTIGO CONSIGNEE', to: 'NOVO CONSIGNEE' },
          { field: 'Peso (kg)', from: '18000', to: '20000' },
        ],
      },
    ])
  })

  it('ignora B/L novo (não existe ainda)', () => {
    const result = computeManifestOverwriteDiff([{ id: 'BL2', consignee: 'X' }], [{ id: 'BL1', consignee: 'Y' }])
    expect(result).toEqual([])
  })

  it('não aponta diff quando os valores são iguais (case-insensitive)', () => {
    const result = computeManifestOverwriteDiff(
      [{ id: 'BL1', consignee: 'acme ltda', pol: 'CNSHA' }],
      [{ id: 'BL1', consignee: 'ACME LTDA', pol: 'CNSHA' }],
    )
    expect(result).toEqual([])
  })

  it('ignora campo que o manifesto não traz (não sinaliza apagar por omissão)', () => {
    const result = computeManifestOverwriteDiff(
      [{ id: 'BL1', consignee: null, shipper: 'NOVO SHIPPER' }],
      [{ id: 'BL1', consignee: 'MANTER', shipper: 'ANTIGO SHIPPER' }],
    )
    expect(result).toEqual([{ bl_number: 'BL1', diffs: [{ field: 'Embarcador', from: 'ANTIGO SHIPPER', to: 'NOVO SHIPPER' }] }])
  })

  it('mostra "—" quando o valor antigo era vazio', () => {
    const result = computeManifestOverwriteDiff([{ id: 'BL1', pod: 'BRSSA' }], [{ id: 'BL1', pod: null }])
    expect(result).toEqual([{ bl_number: 'BL1', diffs: [{ field: 'POD', from: '—', to: 'BRSSA' }] }])
  })
})
