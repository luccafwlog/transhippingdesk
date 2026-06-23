// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ query: { data: undefined as unknown, isLoading: false, error: null as unknown } }))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => state.query,
}))
vi.mock('../../services/lineup', () => ({ fetchLineUpSnapshot: vi.fn() }))

import { LineUpTV } from '../LineUpTV'
import { LineUpTVDisplay } from '../LineUpTVDisplay'

beforeEach(() => {
  state.query = { data: undefined, isLoading: false, error: null }
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })))
})
afterEach(cleanup)

it('US-144: /line-up-tv redireciona para /painel', () => {
  render(
    <MemoryRouter initialEntries={['/line-up-tv']}>
      <Routes>
        <Route path="/line-up-tv" element={<LineUpTV />} />
        <Route path="/painel" element={<div>PAINEL PLACEHOLDER</div>} />
      </Routes>
    </MemoryRouter>,
  )
  expect(screen.getByText('PAINEL PLACEHOLDER')).toBeTruthy()
})

it('US-145: quadro TV mostra estado de carregamento', () => {
  state.query = { data: undefined, isLoading: true, error: null }
  render(<LineUpTVDisplay />)
  expect(screen.getByText('Carregando line up...')).toBeTruthy()
})

it('US-145: quadro TV mostra estado de erro', () => {
  state.query = { data: undefined, isLoading: false, error: new Error('boom') }
  render(<LineUpTVDisplay />)
  expect(screen.getByText('Falha ao carregar o quadro da TV.')).toBeTruthy()
})

it('US-145: quadro TV renderiza a escala do snapshot', () => {
  state.query = {
    data: {
      lastChangedAt: '2026-06-23T00:00:00Z',
      rows: [{
        id: 'r1', voyageId: 1, voyageNumber: 'V1', voyageStatus: 'active', vesselName: 'NAVIO TV',
        pod: 'SSZ', eta: null, etb: null, rowType: 'import', vin: 0, car: 0, cg: 1, total: 1, mty: 0,
        rtw: null, bbMachines: 0, bbPackages: 0, bbTotal: 0, atd: null, ceStatus: 'approved', linked: true,
        exportHasGranite: null, exportContainersQty: null, exportMovementsQty: null, exportCeStatus: null, exportLinked: null,
      }],
    },
    isLoading: false,
    error: null,
  }
  render(<LineUpTVDisplay />)
  expect(screen.getByText('NAVIO TV')).toBeTruthy()
})
