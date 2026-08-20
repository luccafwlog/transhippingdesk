// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

vi.mock('../../../hooks/usePortalScheduleVoyages', () => ({
  usePortalScheduleVoyages: () => ({
    isLoading: false,
    data: [{
      voyageId: 1,
      vesselName: 'ALPHA',
      voyage: '001',
      imoNumber: '9876543',
      datesByLabel: { QINGDAO: '2026-01-04', SALVADOR: '2026-01-22' },
      omittedByLabel: { VITÓRIA: true },
      earliestEta: '2026-01-22',
    }],
  }),
}))

import { ShipScheduleWidget } from '../ShipScheduleWidget'

it('renderiza a programação projetada das viagens visíveis', () => {
  render(<ShipScheduleWidget />)

  expect(screen.getByRole('link', { name: 'ALPHA' }).getAttribute('href')).toBe(
    'https://www.marinetraffic.com/en/ais/details/ships/imo:9876543',
  )
  expect(screen.getByText('04/01/2026')).toBeTruthy()
  expect(screen.getByText('22/01/2026')).toBeTruthy()
  expect(screen.getByText('PECÉM')).toBeTruthy()
  expect(screen.getByText('OMIT')).toBeTruthy()
})
