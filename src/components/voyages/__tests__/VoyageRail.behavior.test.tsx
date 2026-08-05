// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { VoyageRailItem } from '../../../services/voyageSummaries'
import { VoyageRail } from '../VoyageRail'

afterEach(cleanup)

const item = {
  id: 7,
  estado: 'divergente',
  vesselName: 'GREEN SANTOS',
  voyageNumber: '14N',
  carrierName: 'COSCO',
  originPorts: ['BRSSZ'],
  destinationPorts: ['BRVIX'],
  proximaEscala: null,
  escalasBrasileiras: [{ port: 'BRVIX', eta: '2026-08-02' }],
  modules: { container: true, cargaSolta: false, veiculos: false, vazios: false, granito: false },
} as unknown as VoyageRailItem

it('US-212: selecionar uma viagem no rail dispara onSelect com o id', () => {
  const onSelect = vi.fn()
  render(<VoyageRail items={[item]} selectedId={null} onSelect={onSelect} />)

  fireEvent.click(screen.getByText('GREEN SANTOS / 14N').closest('button') as HTMLButtonElement)
  expect(onSelect).toHaveBeenCalledWith(7)
})

it('US-212: rail vazio mostra mensagem de ausencia', () => {
  render(<VoyageRail items={[]} selectedId={null} onSelect={vi.fn()} />)
  expect(screen.getByText('Nenhuma viagem para os filtros atuais.')).toBeTruthy()
})
