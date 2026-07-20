// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  timeline: { data: undefined as unknown, isLoading: false, isError: false },
}))

vi.mock('../../../hooks/useCustomerFicha', () => ({
  useCustomerTimeline: () => mocks.timeline,
}))

import { HistoricoTab } from '../HistoricoTab'

const baseData = { id: 101, customer_contacts: [], bls: [] } as never

afterEach(() => {
  cleanup()
  mocks.timeline = { data: undefined, isLoading: false, isError: false }
})

describe('HistoricoTab — erro de query', () => {
  it('mostra erro explicito, nao "sem eventos registrados", quando a timeline falha', () => {
    mocks.timeline = { data: undefined, isLoading: false, isError: true }
    render(<MemoryRouter><HistoricoTab data={baseData} /></MemoryRouter>)
    expect(screen.getByText('Erro ao carregar histórico.')).toBeTruthy()
    expect(screen.queryByText('Sem eventos registrados.')).toBeNull()
  })
})
