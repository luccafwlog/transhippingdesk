// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { VoyageAgencyReportTab } from '../VoyageAgencyReportTab'

const derived = vi.hoisted(() => vi.fn())
vi.mock('../../../hooks/useAgencyReport', () => ({
  useAgencyReportDerived: derived,
  useAgencyReportOwn: () => ({ data: undefined }),
  useAgencyReportSignoffEvents: () => ({ data: [] }),
  useSetAgencyReportSignoff: () => ({ mutate: vi.fn(), isPending: false }),
  useSetAgencyReportDepartmentSignoff: () => ({ mutate: vi.fn(), isPending: false }),
  useSetAgencyReportSectionObservation: () => ({ mutate: vi.fn() }),
  useSetAgencyReportTerminal: () => ({ mutate: vi.fn() }),
  useCloseAgencyReport: () => ({ mutate: vi.fn(), isPending: false }),
  useReopenAgencyReport: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ effectiveRole: 'operacoes', isAdmin: false }) }))

afterEach(() => { cleanup(); derived.mockReset() })

const props = { voyageId: 7, voyageLabel: 'NAVIO TESTE / 01E', carrierName: 'Armador teste', pods: ['BRVIX'] }

it('renderiza a fase de operação de pátio com o modelo de serviços atual', () => {
  derived.mockReturnValue({ data: { containers: [], vehicles: [], vaziosImp: [], granite: [], vaziosExp: [], storage: { containers: 0, days: 0 }, operation: { os_number: 'OS-42', service_qty: [{ depot_service_id: 'svc-1', qty: 3 }] } }, isLoading: false, error: null })
  render(<VoyageAgencyReportTab {...props} />)
  expect(screen.getAllByText(/Opera/).length).toBeGreaterThan(0)
  expect(screen.getByText('OS-42')).toBeTruthy()
})

it('contabiliza overtime pelos bookings com percentual positivo', () => {
  derived.mockReturnValue({ data: { containers: [], vehicles: [], vaziosImp: [], granite: [], vaziosExp: [{ id: 'b1', overtime_pct: 25 }, { id: 'b2', overtime_pct: 0 }], storage: { containers: 0, days: 0 }, operation: { os_number: null, service_qty: [] } }, isLoading: false, error: null })
  render(<VoyageAgencyReportTab {...props} />)
  expect(screen.getByText('1')).toBeTruthy()
})
