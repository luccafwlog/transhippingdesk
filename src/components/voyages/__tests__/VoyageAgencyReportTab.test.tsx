// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { VoyageAgencyReportTab } from '../VoyageAgencyReportTab'

const { useAgencyReportDerivedMock, useAgencyReportOwnMock, closeMutateMock } = vi.hoisted(() => ({
  useAgencyReportDerivedMock: vi.fn(),
  useAgencyReportOwnMock: vi.fn(),
  closeMutateMock: vi.fn(),
}))

vi.mock('../../../hooks/useAgencyReport', () => ({
  useAgencyReportDerived: useAgencyReportDerivedMock,
  useAgencyReportOwn: useAgencyReportOwnMock,
  useSetAgencyReportSignoff: () => ({ mutate: vi.fn() }),
  useAddAgencyReportOccurrence: () => ({ mutate: vi.fn() }),
  useSetAgencyReportTerminal: () => ({ mutate: vi.fn() }),
  useCloseAgencyReport: () => ({ mutate: closeMutateMock, isPending: false }),
  useReopenAgencyReport: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ effectiveRole: 'operacoes', isAdmin: false }) }))

afterEach(cleanup)

useAgencyReportDerivedMock.mockReturnValue({ data: undefined, isLoading: false, error: null })
useAgencyReportOwnMock.mockReturnValue({ data: undefined })

it('abre a escala indicada no deep-link e permite trocar a escala do ADR', () => {
  render(
    <VoyageAgencyReportTab
      voyageId={7}
      voyageLabel="NAVIO TESTE / 01E"
      carrierName="Armador teste"
      pods={['BRVIX', 'BRRIO']}
      initialEscala="BRRIO"
    />,
  )

  expect(screen.getByRole('button', { name: 'BRRIO' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'BRVIX' }))
  expect(screen.getByRole('button', { name: 'BRVIX' }).getAttribute('aria-pressed')).toBe('true')
})

it('exibe o percentual de overtime por depot da operação derivada', () => {
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vehicles: [], vaziosImp: [], granite: [], vaziosExp: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, reorg: [], overtime: [{ id: 'ot-1', depot: 'VBR', percent: 25 }] },
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={['BRVIX']} />)

  expect(screen.getByText('VBR')).toBeTruthy()
  expect(screen.getByText('25%')).toBeTruthy()
})

it('exibe o progresso, sign-off da seção do usuário e ocorrências do relatório', () => {
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: [{ id: 'so-1', section: 'datas', state: 'confirmed' }],
      occurrences: [{ id: 'occ-1', body: 'Atracação concluída.', department: 'operacoes', created_at: '2026-07-19T10:00:00Z' }],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={['BRVIX']} />)

  expect(screen.getByText('1/7 confirmadas')).toBeTruthy()
  expect(screen.getAllByText('Confirmado')).toHaveLength(2)
  expect(screen.getAllByRole('button', { name: 'Nada a declarar' })).toHaveLength(2)
  expect(screen.getByText('Atracação concluída.')).toBeTruthy()
})

it('fecha o ADR apenas quando todas as seções foram confirmadas e envia o snapshot exibido', () => {
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: ['datas', 'carga_descarregada', 'carga_carregada', 'veiculos', 'vazios_embarcados', 'vazios_descarregados', 'ocorrencias']
        .map((section) => ({ id: section, section, state: 'confirmed' })),
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={['BRVIX']} />)

  const closeButton = screen.getByRole('button', { name: 'Fechar ADR' })
  expect((closeButton as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(closeButton)
  expect(closeMutateMock).toHaveBeenCalledWith(expect.objectContaining({
    voyageId: 7,
    port: 'BRVIX',
    snapshot: expect.objectContaining({ sections: expect.any(Object) }),
  }))
})

it('exibe a carga solta derivada e a congela sob cargaSolta no snapshot', () => {
  const cargaSolta = { bls: 2, machines: 3, packages: 12, weightTon: 6, cbm: 20 }
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      cargaSolta,
      containers: [], vehicles: [], vaziosImp: [], granite: [], vaziosExp: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, reorg: [], overtime: [] },
    },
    isLoading: false,
    error: null,
  })
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: ['datas', 'carga_descarregada', 'carga_carregada', 'veiculos', 'vazios_embarcados', 'vazios_descarregados', 'ocorrencias']
        .map((section) => ({ id: section, section, state: 'confirmed' })),
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={['BRVIX']} />)

  expect(screen.getByText('Máquinas')).toBeTruthy()
  expect(screen.getByText('3')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Fechar ADR' }))
  expect(closeMutateMock).toHaveBeenCalledWith(expect.objectContaining({
    snapshot: expect.objectContaining({
      sections: expect.objectContaining({ cargaSolta }),
    }),
  }))
})
