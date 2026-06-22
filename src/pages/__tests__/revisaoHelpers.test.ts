import { describe, expect, it } from 'vitest'
import {
  customerHasEmail,
  getConsigneeFilterOptions,
  getReviewItemCnpj,
  getReviewItemDisplayName,
  getSelectionConsignee,
  groupNeedsEmail,
  groupNeedsPortal,
  groupReviewItems,
  needsCeMercante,
  needsCustomerLink,
  needsWeightFix,
} from '../revisaoHelpers'
import type { ReviewQueueItem } from '../../hooks/useReview'

function item(overrides: Record<string, unknown>): ReviewQueueItem {
  return { source: 'bl', customer_id: 1, review_reasons: [], cargo_mode: 'container', ...overrides } as unknown as ReviewQueueItem
}

describe('needsCustomerLink', () => {
  it('é verdadeiro só quando não há cliente vinculado', () => {
    expect(needsCustomerLink(item({ customer_id: null }))).toBe(true)
    expect(needsCustomerLink(item({ customer_id: 5 }))).toBe(false)
  })
})

describe('needsCeMercante', () => {
  it('só vale para itens de B/L com motivo de CE Mercante', () => {
    expect(needsCeMercante(item({ source: 'granite', review_reasons: ['CE Mercante ausente'] }))).toBe(false)
    expect(needsCeMercante(item({ source: 'bl', review_reasons: ['CE Mercante ausente'] }))).toBe(true)
    expect(needsCeMercante(item({ source: 'bl', review_reasons: ['ceMercante faltando'] }))).toBe(true)
    expect(needsCeMercante(item({ source: 'bl', review_reasons: ['outro motivo'] }))).toBe(false)
  })
})

describe('needsWeightFix', () => {
  it('detecta pelo motivo de revisão', () => {
    expect(needsWeightFix(item({ source: 'bl', review_reasons: ['Weight Ton ausente'] }))).toBe(true)
    expect(needsWeightFix(item({ source: 'bl', review_reasons: ['peso BB invalido'] }))).toBe(true)
  })

  it('detecta carga solta sem peso em toneladas', () => {
    expect(needsWeightFix(item({ source: 'bl', cargo_mode: 'carga_solta', bb_weight_ton: null }))).toBe(true)
    expect(needsWeightFix(item({ source: 'bl', cargo_mode: 'carga_solta', bb_weight_ton: 0 }))).toBe(true)
    expect(needsWeightFix(item({ source: 'bl', cargo_mode: 'carga_solta', bb_weight_ton: 12 }))).toBe(false)
  })

  it('não vale para container sem motivo, nem para fontes não-B/L', () => {
    expect(needsWeightFix(item({ source: 'bl', cargo_mode: 'container' }))).toBe(false)
    expect(needsWeightFix(item({ source: 'granite', cargo_mode: 'carga_solta', bb_weight_ton: null }))).toBe(false)
  })
})


describe('getConsigneeFilterOptions', () => {
  it('lista consignatarios unicos ordenados, ignorando vazios', () => {
    const rows = [
      item({ id: 'BL1', consignee: 'Beta Trading' }),
      item({ id: 'BL2', consignee: '  Alfa Import  ' }),
      item({ id: 'BL3', consignee: 'Beta Trading' }),
      item({ id: 'BL4', consignee: '' }),
      item({ id: 'BL5', consignee: null }),
    ]

    expect(getConsigneeFilterOptions(rows)).toEqual(['Alfa Import', 'Beta Trading'])
  })
})

describe('getSelectionConsignee', () => {
  it('retorna o consignatario quando todos os selecionados pertencem ao mesmo', () => {
    const rows = [
      item({ id: 'BL1', consignee: 'AC Comercial' }),
      item({ id: 'BL2', consignee: ' AC Comercial ' }),
    ]

    expect(getSelectionConsignee(rows)).toBe('AC Comercial')
  })

  it('retorna null quando a selecao mistura consignatarios', () => {
    const rows = [
      item({ id: 'BL1', consignee: 'AC Comercial' }),
      item({ id: 'BL2', consignee: 'Alma Trading' }),
    ]

    expect(getSelectionConsignee(rows)).toBeNull()
  })

  it('retorna null quando algum selecionado nao tem consignatario', () => {
    const rows = [
      item({ id: 'BL1', consignee: 'AC Comercial' }),
      item({ id: 'BL2', consignee: null }),
    ]

    expect(getSelectionConsignee(rows)).toBeNull()
  })
})

describe('getReviewItemCnpj', () => {
  it('prioriza o CNPJ do cliente cadastrado sobre o do manifesto', () => {
    const it1 = item({
      customer: { id: 1, name: 'Cliente X', cnpj_cpf: '11.222.333/0001-81' },
      manifest_customer_cnpj_cpf: '99999999999999',
    })
    expect(getReviewItemCnpj(it1)).toBe('11222333000181')
  })

  it('usa o CNPJ do manifesto quando nao ha cliente vinculado', () => {
    expect(getReviewItemCnpj(item({ customer: null, manifest_customer_cnpj_cpf: '11222333000181' }))).toBe(
      '11222333000181',
    )
    expect(getReviewItemCnpj(item({ customer: null, manifest_customer_cnpj_cpf: null }))).toBeNull()
  })
})

describe('getReviewItemDisplayName', () => {
  it('usa a razao social do cliente cadastrado quando existe', () => {
    expect(
      getReviewItemDisplayName(item({ customer: { id: 1, name: 'Razao Social SA', cnpj_cpf: '1' }, consignee: 'CNEE LTDA' })),
    ).toBe('Razao Social SA')
  })

  it('cai para o consignatario do manifesto quando nao ha cliente', () => {
    expect(getReviewItemDisplayName(item({ customer: null, consignee: 'CNEE LTDA' }))).toBe('CNEE LTDA')
  })
})

describe('groupReviewItems', () => {
  it('agrupa pelo CNPJ e nomeia pelo cliente cadastrado, ordenando por nome', () => {
    const rows = [
      item({ id: 'BL1', customer: null, consignee: 'ALFA', manifest_customer_cnpj_cpf: '11222333000181' }),
      item({
        id: 'BL2',
        customer: { id: 7, name: 'Alfa Comercio SA', cnpj_cpf: '11222333000181' },
        consignee: 'ALFA',
      }),
      item({ id: 'BL3', customer: null, consignee: 'BETA', manifest_customer_cnpj_cpf: '55666777000122' }),
    ]

    const groups = groupReviewItems(rows)
    expect(groups).toHaveLength(2)
    const alfa = groups.find((g) => g.cnpj === '11222333000181')!
    expect(alfa.items).toHaveLength(2)
    // razao social cadastrada vence o texto do manifesto
    expect(alfa.displayName).toBe('Alfa Comercio SA')
    // ordem alfabetica por nome de exibicao
    expect(groups[0].displayName).toBe('Alfa Comercio SA')
  })

  it('agrupa por nome quando nao ha CNPJ', () => {
    const rows = [
      item({ id: 'BL1', customer: null, consignee: 'SEM DOC', manifest_customer_cnpj_cpf: null }),
      item({ id: 'BL2', customer: null, consignee: 'sem doc', manifest_customer_cnpj_cpf: null }),
    ]
    expect(groupReviewItems(rows)).toHaveLength(1)
  })
})

describe('customerHasEmail', () => {
  it('detecta e-mail em qualquer contato (qualquer classificacao)', () => {
    expect(customerHasEmail(item({ customer: { id: 1, name: 'X', cnpj_cpf: '1', customer_contacts: [{ email: 'a@b.com' }] } }))).toBe(true)
    expect(customerHasEmail(item({ customer: { id: 1, name: 'X', cnpj_cpf: '1', customer_contacts: [{ email: '  ' }] } }))).toBe(false)
    expect(customerHasEmail(item({ customer: { id: 1, name: 'X', cnpj_cpf: '1', customer_contacts: [] } }))).toBe(false)
  })
})

describe('groupNeedsEmail / groupNeedsPortal', () => {
  it('usa as pendencias canonicas quando ha cliente vinculado', () => {
    const linkedNoEmail = groupReviewItems([
      item({
        id: 'B1',
        customer_id: 7,
        customer: { id: 7, name: 'C', cnpj_cpf: '11222333000181', customer_contacts: [] },
        review_reasons: ['Cliente sem e-mail cadastrado', 'Acesso ao portal nao provisionado'],
      }),
    ])[0]
    expect(groupNeedsEmail(linkedNoEmail)).toBe(true)
    expect(groupNeedsPortal(linkedNoEmail)).toBe(true)

    const linkedComplete = groupReviewItems([
      item({
        id: 'B2',
        customer_id: 7,
        customer: { id: 7, name: 'C', cnpj_cpf: '11222333000181', customer_contacts: [{ email: 'a@b.com' }] },
        review_reasons: [],
      }),
    ])[0]
    expect(groupNeedsEmail(linkedComplete)).toBe(false)
    expect(groupNeedsPortal(linkedComplete)).toBe(false)

    const unlinked = groupReviewItems([
      item({ id: 'B3', customer_id: null, customer: null, consignee: 'X', manifest_customer_cnpj_cpf: '11222333000181' }),
    ])[0]
    // sem cliente vinculado, e-mail/portal nao travam (a trava e "vincular cliente")
    expect(groupNeedsEmail(unlinked)).toBe(false)
    expect(groupNeedsPortal(unlinked)).toBe(false)
  })
})
