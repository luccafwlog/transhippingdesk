import { describe, expect, it, vi } from 'vitest'
import { describeVoyageMismatch, importBlDocument } from '../blDocumentImport'
import type { ParsedBlDocument } from '../blDocumentParser'

// blDocumentImport chega no supabase pelo breakbulkImport; estes testes cobrem
// a decisão que acontece antes da escrita.
vi.mock('../supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}))

function blDocument(overrides: Partial<ParsedBlDocument> = {}): ParsedBlDocument {
  return {
    format: 'pdf',
    layout: 'labeled',
    bl_id: 'DX75ZJGVIT02',
    shipper: 'SHIPPER LTDA',
    consignee: 'IMPORTADOR LTDA',
    notify_party: null,
    cnpj_cpf: '13532646000161',
    vessel_name: 'DA XIN',
    voyage_number: '75',
    pol: 'CNZJG',
    pod: 'BRVIX',
    pol_raw: 'ZHANGJIAGANG,CN',
    pod_raw: 'VITORIA,BR',
    originals: 3,
    packages_qty: 5,
    package_unit: 'CASES',
    machine_qty: null,
    cargo_description: 'STAINLESS STEEL SEAMLESS PIPE',
    ncm_codes: ['7304'],
    marks: 'N/M',
    gross_weight_kg: 11652,
    total_cbm: 5.39,
    freight_terms: 'PREPAID',
    place_and_date_of_issue: null,
    remarks: null,
    errors: [],
    warnings: [],
    ...overrides,
  }
}

describe('describeVoyageMismatch', () => {
  it('não acusa divergência quando navio e viagem batem', () => {
    expect(
      describeVoyageMismatch(blDocument(), { voyage_number: '75', vessel: { name: 'DA XIN' } }),
    ).toBeNull()
  })

  it('aceita o alias de prefixo do nome do navio', () => {
    const document = blDocument({ vessel_name: 'CS XING WANG', voyage_number: '33' })

    expect(
      describeVoyageMismatch(document, { voyage_number: '33', vessel: { name: 'COSCO SHIPPING XING WANG' } }),
    ).toBeNull()
  })

  // O armador escreve a mesma viagem como "33", "033" ou "V.33".
  it('ignora zeros à esquerda e pontuação no número da viagem', () => {
    expect(
      describeVoyageMismatch(blDocument({ voyage_number: '75' }), {
        voyage_number: '075',
        vessel: { name: 'DA XIN' },
      }),
    ).toBeNull()
  })

  it('acusa navio diferente', () => {
    const reason = describeVoyageMismatch(blDocument(), {
      voyage_number: '75',
      vessel: { name: 'COSCO SHIPPING XING WANG' },
    })

    expect(reason).toContain('DA XIN / 75')
    expect(reason).toContain('COSCO SHIPPING XING WANG / 75')
  })

  it('acusa viagem diferente do mesmo navio', () => {
    expect(
      describeVoyageMismatch(blDocument(), { voyage_number: '76', vessel: { name: 'DA XIN' } }),
    ).toContain('mas você apontou')
  })

  it('sem viagem escolhida ou sem navio no documento não há o que comparar', () => {
    expect(describeVoyageMismatch(blDocument(), null)).toBeNull()
    expect(
      describeVoyageMismatch(blDocument({ vessel_name: null }), { voyage_number: '99', vessel: { name: 'OUTRO' } }),
    ).toBeNull()
  })
})

describe('importBlDocument', () => {
  it('recusa documento sem número de B/L antes de tocar no banco', async () => {
    const document = blDocument({ bl_id: '', errors: ['Número do B/L não encontrado no documento.'] })

    await expect(
      importBlDocument({ filename: 'bl.pdf', voyageId: 10, document, uploadedBy: 'user-1' }),
    ).rejects.toThrow('bl.pdf: Número do B/L não encontrado no documento.')
  })
})
