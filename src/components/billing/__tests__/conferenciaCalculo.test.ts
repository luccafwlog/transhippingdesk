import { describe, expect, it } from 'vitest'
import { applicationBasisLabel, groupChargeLinesByTable, sumChargeLines } from '../conferenciaCalculo'
import type { LocalChargeLine } from '../../../services/charges/chargeOperationsService'

const base: LocalChargeLine = {
  id: 1,
  bl_id: 'BL-001',
  charge_table_id: 10,
  charge_item_id: 100,
  charge_name: 'THC',
  charge_table_name: 'Taxas Locais — Vitória',
  charge_table_pod: 'BRVIX',
  application_basis: 'per_container',
  source: 'auto',
  status: 'calculated',
  quantity: 2,
  currency: 'BRL',
  unit_value_brl: 500,
  unit_value_usd: null,
  total_value_brl: 1000,
  total_value_usd: null,
  override_applied: false,
  calculation_key: null,
  notes: null,
  review_reason: null,
  calculated_at: null,
}

function line(overrides: Partial<LocalChargeLine>): LocalChargeLine {
  return { ...base, ...overrides }
}

describe('conferência de cálculo — agrupamento por tabela', () => {
  it('agrupa pela tabela que produziu a linha e soma o subtotal do grupo', () => {
    const groups = groupChargeLinesByTable([
      line({ id: 1, total_value_brl: 1000 }),
      line({ id: 2, charge_name: 'Drop-off', total_value_brl: 250 }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].title).toBe('Taxas Locais — Vitória')
    expect(groups[0].totalBrl).toBe(1250)
    expect(groups[0].lines.map((l) => l.id)).toEqual([1, 2])
  })

  // A tabela sai do porto de descarga: e o dado que responde "por que este valor".
  it('nomeia o porto de descarga da tabela pelo alias, não pelo LOCODE', () => {
    const [group] = groupChargeLinesByTable([line({})])
    expect(group.subtitle).toBe('Descarga em VITORIA')
  })

  it('separa tabelas diferentes, mantendo cada subtotal no seu grupo', () => {
    const groups = groupChargeLinesByTable([
      line({ id: 1, total_value_brl: 1000 }),
      line({
        id: 2,
        charge_table_id: 20,
        charge_table_name: 'Taxas Locais — Salvador',
        charge_table_pod: 'BRSSA',
        total_value_brl: 300,
      }),
    ])

    expect(groups.map((g) => g.title)).toEqual(['Taxas Locais — Salvador', 'Taxas Locais — Vitória'])
    expect(groups.map((g) => g.totalBrl)).toEqual([300, 1000])
  })

  it('põe lançamentos manuais em grupo próprio, mesmo com tabela na linha', () => {
    const groups = groupChargeLinesByTable([line({ id: 1 }), line({ id: 2, source: 'manual', total_value_brl: 80 })])

    expect(groups.map((g) => g.kind)).toEqual(['tabela', 'manual'])
    expect(groups[1].title).toBe('Lançamentos manuais')
    expect(groups[1].totalBrl).toBe(80)
  })

  // Linha automatica sem tabela nao e estado esperado: some da conferencia se
  // for misturada com as demais, e e justamente o caso que precisa aparecer.
  it('isola como anomalia a linha automática sem tabela vinculada', () => {
    const groups = groupChargeLinesByTable([line({ id: 1 }), line({ id: 2, charge_table_id: null, charge_table_name: null })])

    expect(groups.map((g) => g.kind)).toEqual(['tabela', 'sem_tabela'])
    expect(groups[1].title).toBe('Sem tabela vinculada')
  })

  it('cai no número da tabela quando o cadastro não tem nome', () => {
    const [group] = groupChargeLinesByTable([line({ charge_table_name: null })])
    expect(group.title).toBe('Tabela #10')
  })

  it('soma BRL e USD separadamente, sem converter moeda', () => {
    const total = sumChargeLines([
      line({ id: 1, total_value_brl: 1000, total_value_usd: null }),
      line({ id: 2, total_value_brl: 0, currency: 'USD', total_value_usd: 40 }),
    ])
    expect(total).toEqual({ totalBrl: 1000, totalUsd: 40 })
  })

  it('devolve lista vazia sem linhas', () => {
    expect(groupChargeLinesByTable([])).toEqual([])
  })
})

describe('base de aplicação', () => {
  it('humaniza as bases conhecidas', () => {
    expect(applicationBasisLabel('per_container')).toBe('por container')
    expect(applicationBasisLabel('per_ton')).toBe('por tonelada')
  })

  it('não inventa rótulo para base desconhecida nem para ausência', () => {
    expect(applicationBasisLabel('per_teu')).toBe('per teu')
    expect(applicationBasisLabel(null)).toBeNull()
    expect(applicationBasisLabel('  ')).toBeNull()
  })
})
