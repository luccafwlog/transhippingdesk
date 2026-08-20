// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ReviewDocumentEvidence } from '../ReviewDocumentEvidence'
import type { ReviewGroup } from '../../../pages/revisaoHelpers'

function group(overrides: Partial<ReviewGroup>): ReviewGroup {
  return { key: 'conflict:BL1', cnpj: null, displayName: 'Alfa', identityKind: 'conflict', candidateCnpjs: ['11222333000181', '55666777000144'], canBulkOnboard: false, items: [{ id: 'BL1', source: 'bl', consignee: 'Alfa', consignee_block: 'Alfa Ltda\nCNPJ: 11.222.333/0001-81', cargo_description: 'Carga\nCNPJ: 55.666.777/001-44' }] as never, ...overrides }
}

describe('ReviewDocumentEvidence', () => {
  it('mostra CNPJs candidatos e textos extraídos do B/L', async () => {
    const user = userEvent.setup()
    render(<ReviewDocumentEvidence group={group({})} />)
    expect(screen.getByText(/CNPJs conflitantes/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /B\/L BL1/ }))
    expect(screen.getAllByText(/11\.222\.333\/0001-81/).length).toBeGreaterThan(0)
    expect(screen.getByText(/55\.666\.777\/0001-44/)).toBeTruthy()
  })
})
