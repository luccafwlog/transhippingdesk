// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { BlTransshipmentCard } from '../BlTransshipmentCard'

const omission = { id: 9, voyageId: 7, omittedPod: 'VITORIA', dischargePod: 'SANTOS', reason: null, onwardVesselName: 'MSC X', onwardCarrier: 'MSC', onwardVoyageNumber: '123A', onwardEtd: '2026-07-10', onwardEta: '2026-07-14' }

describe('BlTransshipmentCard', () => {
  it('exibe dados herdados e acao COD', () => {
    render(<MemoryRouter><BlTransshipmentCard omission={omission} disposition="transshipment" saving={false} onCod={vi.fn()} onRestore={vi.fn()} /></MemoryRouter>)
    expect(screen.getByText(/SANTOS/)).toBeTruthy()
    expect(screen.getByText('MSC X')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Marcar COD/ })).toBeTruthy()
  })
  it('exibe reversao quando disposicao e COD', () => {
    render(<MemoryRouter><BlTransshipmentCard omission={omission} disposition="cod" saving={false} onCod={vi.fn()} onRestore={vi.fn()} /></MemoryRouter>)
    expect(screen.getByText(/COD SANTOS/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Reverter para transbordo/ })).toBeTruthy()
  })
})
