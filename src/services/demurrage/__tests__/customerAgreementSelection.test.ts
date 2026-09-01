import { describe, expect, it } from 'vitest'
import { selectAgreementForDischargeDate } from '../customerDemurrageAgreements'

// Ordenados por vigência decrescente, como as consultas entregam.
const acordos = [
  { id: 2, valid_from: '2026-01-01', valid_to: null as string | null },
  { id: 1, valid_from: '2025-01-01', valid_to: '2025-12-31' },
]

describe('selectAgreementForDischargeDate', () => {
  // O bug que motivou a extração: guardar "o acordo do cliente" antes de olhar a
  // data fazia o vencido mascarar o vigente, e a cobrança caía na tabela padrão.
  it('escolhe pela data de descarga, não pela ordem em que o acordo veio', () => {
    expect(selectAgreementForDischargeDate(acordos, '2026-03-10')?.id).toBe(2)
    expect(selectAgreementForDischargeDate(acordos, '2025-06-10')?.id).toBe(1)
  })

  it('devolve nulo quando nenhum acordo cobre a data', () => {
    expect(selectAgreementForDischargeDate(acordos, '2024-06-10')).toBeNull()
  })

  it('respeita o fim da vigência e o acordo sem data de término', () => {
    expect(selectAgreementForDischargeDate([acordos[1]], '2026-01-02')).toBeNull()
    expect(selectAgreementForDischargeDate([acordos[0]], '2099-01-01')?.id).toBe(2)
  })

  it('sem data de descarga não escolhe acordo nenhum', () => {
    expect(selectAgreementForDischargeDate(acordos, null)).toBeNull()
    expect(selectAgreementForDischargeDate(acordos, '')).toBeNull()
  })

  // Vigências sobrepostas: vence o primeiro da lista, que é o mais recente.
  it('com períodos sobrepostos, o mais recente vence', () => {
    const sobrepostos = [
      { id: 3, valid_from: '2026-02-01', valid_to: null as string | null },
      { id: 2, valid_from: '2026-01-01', valid_to: null as string | null },
    ]
    expect(selectAgreementForDischargeDate(sobrepostos, '2026-03-01')?.id).toBe(3)
  })
})
