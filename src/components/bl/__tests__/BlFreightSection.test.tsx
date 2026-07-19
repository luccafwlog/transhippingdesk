// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BlFreightSection } from '../BlFreightSection'

const lines = [
  { bl_id: 'BL1', seq: 1, description: 'OCEAN FREIGHT', category: 'OCEAN_FREIGHT', mercante_code: null, currency: 'USD', amount: 1500, payment: 'PREPAID' as const },
  { bl_id: 'BL1', seq: 2, description: 'THD', category: 'OTHER', mercante_code: null, currency: 'BRL', amount: 900.5, payment: 'COLLECT' as const },
]

describe('BlFreightSection', () => {
  it('lista as linhas importadas com moeda, valor e prepaid/collect', () => {
    render(<BlFreightSection freightLines={lines} />)
    expect(screen.getByText('OCEAN FREIGHT')).toBeTruthy()
    expect(screen.getByText('PREPAID')).toBeTruthy()
    expect(screen.getByText('THD')).toBeTruthy()
    expect(screen.getByText(/900,5/)).toBeTruthy()
  })

  it('mostra vazio orientando o import quando nao ha linhas', () => {
    render(<BlFreightSection freightLines={[]} />)
    expect(screen.getByText(/Nenhuma linha de frete importada/)).toBeTruthy()
  })
})
