import { describe, expect, it } from 'vitest'

// Prova aritmética da fórmula usada em calculate_bl_local_charges (migration
// 269, etapa 13 do plano de faturamento, achado 9): dividir uma tarifa por
// N partes e arredondar cada uma independentemente perde centavos quando a
// divisão não é exata (ex.: R$100/3 = R$33,33 × 3 = R$99,99). A correção dá
// ao último rateio do grupo o resto: rate - (N-1) * round(rate/N, 2).
function shareAmount(rate: number, shareCount: number, isLast: boolean): number {
  const perShare = Math.round((rate / shareCount) * 100) / 100
  if (!isLast) return perShare
  return Math.round((rate - (shareCount - 1) * perShare) * 100) / 100
}

function sumOfShares(rate: number, shareCount: number): number {
  let total = 0
  for (let i = 0; i < shareCount; i++) {
    const isLast = i === shareCount - 1
    total += shareAmount(rate, shareCount, isLast)
  }
  return Math.round(total * 100) / 100
}

describe('pro-rata rounding — o último rateio absorve a diferença', () => {
  it('a soma das partes sempre fecha a tarifa cheia, mesmo quando a divisão não é exata', () => {
    const cases: Array<[rate: number, shareCount: number]> = [
      [100, 3], // caso do plano: 33.33 × 3 = 99.99 sem correção
      [100, 7],
      [250.5, 4],
      [10, 6],
      [99.97, 3],
      [1, 3],
    ]
    for (const [rate, shareCount] of cases) {
      expect(sumOfShares(rate, shareCount)).toBe(rate)
    }
  })

  it('divisão exata não muda de comportamento (todo mundo paga igual)', () => {
    expect(shareAmount(300, 3, false)).toBe(100)
    expect(shareAmount(300, 3, true)).toBe(100)
  })

  it('reproduz o caso do plano: sem correção perderia 1 centavo do container', () => {
    const naive = Math.round((100 / 3) * 100) / 100 // 33.33
    expect(Math.round(naive * 3 * 100) / 100).toBe(99.99) // o bug que o achado 9 descreve
    expect(sumOfShares(100, 3)).toBe(100) // com a correção, fecha
  })
})
