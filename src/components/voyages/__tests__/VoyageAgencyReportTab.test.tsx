// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { VoyageAgencyReportTab } from '../VoyageAgencyReportTab'
import { formatBRL } from '../../../lib/utils'

const { useAgencyReportDerivedMock, useAgencyReportOwnMock, closeMutateMock, reopenMutateMock, useAuthMock } = vi.hoisted(() => ({
  useAgencyReportDerivedMock: vi.fn(),
  useAgencyReportOwnMock: vi.fn(),
  closeMutateMock: vi.fn(),
  reopenMutateMock: vi.fn(),
  useAuthMock: vi.fn(),
}))

const { signoffMutateMock, departmentSignoffMutateMock, observationMutateMock, useAgencyReportSignoffEventsMock } = vi.hoisted(() => ({
  signoffMutateMock: vi.fn(),
  departmentSignoffMutateMock: vi.fn(),
  observationMutateMock: vi.fn(),
  useAgencyReportSignoffEventsMock: vi.fn(),
}))

vi.mock('../../../hooks/useAgencyReport', () => ({
  useAgencyReportDerived: useAgencyReportDerivedMock,
  useAgencyReportOwn: useAgencyReportOwnMock,
  useAgencyReportSignoffEvents: useAgencyReportSignoffEventsMock,
  useSetAgencyReportSignoff: () => ({ mutate: signoffMutateMock, isPending: false }),
  useSetAgencyReportDepartmentSignoff: () => ({ mutate: departmentSignoffMutateMock, isPending: false }),
  useSetAgencyReportSectionObservation: () => ({ mutate: observationMutateMock }),
  useSetAgencyReportTerminal: () => ({ mutate: vi.fn() }),
  useCloseAgencyReport: () => ({ mutate: closeMutateMock, isPending: false }),
  useReopenAgencyReport: () => ({ mutate: reopenMutateMock, isPending: false }),
}))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: useAuthMock }))

const ALL_SECTIONS = [
  'datas', 'carga_descarregada', 'carga_carregada', 'veiculos',
  'vazios_embarcados', 'vazios_descarregados', 'operacao_patio',
]

function allSectionsSignoffs(state = 'confirmed') {
  return ALL_SECTIONS.map((section) => ({ id: section, section, state }))
}

function allDepartmentsSigned() {
  return [
    { id: 'ds-1', department: 'operacoes', signed_by: 'user-1', signed_at: '2026-07-20T09:00:00Z' },
    { id: 'ds-2', department: 'documentacao', signed_by: 'user-1', signed_at: '2026-07-20T09:00:00Z' },
    { id: 'ds-3', department: 'equipamentos', signed_by: 'user-1', signed_at: '2026-07-20T09:00:00Z' },
  ]
}

afterEach(cleanup)

useAgencyReportDerivedMock.mockReturnValue({ data: undefined, isLoading: false, error: null })
useAgencyReportOwnMock.mockReturnValue({ data: undefined })
useAgencyReportSignoffEventsMock.mockReturnValue({ data: [] })
useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })

it('abre a escala indicada no deep-link e permite trocar a escala do ADR', () => {
  render(
    <VoyageAgencyReportTab
      voyageId={7}
      voyageLabel="NAVIO TESTE / 01E"
      carrierName="Armador teste"
      pods={[{ pod: 'BRVIX', omitted: false }, { pod: 'BRRIO', omitted: false }]}
      initialEscala="BRRIO"
    />,
  )

  expect(screen.getByRole('button', { name: 'BRRIO' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'BRVIX' }))
  expect(screen.getByRole('button', { name: 'BRVIX' }).getAttribute('aria-pressed')).toBe('true')
})

it('exibe unidades sem armazenagem na fase Operacao de patio', () => {
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vehicles: [], vaziosImp: [], granite: [],
      vaziosExp: [
        { container_type: '40HC', local_id: 'tvv', condition: 'vazio', local: { id: 'tvv', code: 'TVV', name: 'TVV', tipo: 'terminal_portuario' } },
        { container_type: '40HC', local_id: 'd1', condition: 'vazio', local: { id: 'd1', code: 'VBR', name: 'VBR', tipo: 'depot' } },
      ],
      storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
    },
    isLoading: false,
    error: null,
  })
  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)
  const patioSection = screen.getByRole('heading', { name: /Opera.*o de p.*tio/, level: 3 }).closest('section')!
  expect(within(patioSection).getByText('Unidades sem armazenagem')).toBeTruthy()
})

it('exibe a linha de serviço pelo nome, nao pelo id', () => {
  useAgencyReportDerivedMock.mockReturnValue({
    data: { containers: [], vehicles: [], vaziosImp: [], granite: [], vaziosExp: [], storage: { containers: 0, days: 0 }, operation: {}, costs: { total: 3, serviceLines: [{ id: 'l1', service: { name: 'Bundle Composition' }, local: { name: 'VBR' }, destino: null, local_id: 'd1', service_id: 's1', container_type: null, quantidade: 3, percentual: 100, valor_unitario: 1, total: 3 }] } },
    isLoading: false,
    error: null,
  })
  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)
  expect(screen.getByText('Bundle Composition')).toBeTruthy()
  const serviceTable = screen.getByText('Bundle Composition').closest('table')!
  expect(within(serviceTable).queryByRole('columnheader', { name: '%' })).toBeNull()
  expect(within(serviceTable).queryByText('100')).toBeNull()
})

it('a soma das linhas exibidas bate com o "Total da operação" para uma linha legada de armazenagem com percentual não nulo', () => {
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vehicles: [], vaziosImp: [], granite: [], vaziosExp: [], storage: { containers: 0, days: 0 }, operation: {},
      costs: {
        total: 1000,
        serviceLines: [{
          id: 'l1', service: { name: 'Armazenagem' }, local: { name: 'VBR' }, destino: null, local_id: 'd1', service_id: 's1',
          container_type: null, quantidade: 10, percentual: 50, valor_unitario: 100, total: 1000,
        }],
      },
    },
    isLoading: false,
    error: null,
  })
  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)
  const patioSection = screen.getByRole('heading', { name: /Opera.*o de p.*tio/, level: 3 }).closest('section')!
  // O total da linha (lido de service.total, calculado por totalLinha) e o
  // "Total da operação" precisam bater — antes da Task 8, a fórmula inline da
  // linha aplicava o percentual legado (50%) e mostrava R$ 500,00. Compara via
  // textContent (sem normalização de espaço) para não depender do NBSP que
  // formatBRL usa entre "R$" e o valor.
  const occurrences = patioSection.textContent!.split(formatBRL(1000)).length - 1
  expect(occurrences).toBe(2)
})

it('exibe a barra-resumo dos 3 departamentos e o sign-off da seção do usuário', () => {
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: [{ id: 'so-1', section: 'datas', state: 'confirmed', signed_by: 'user-1', signed_at: '2026-07-19T12:00:00Z' }],
      departmentSignoffs: [],
      occurrences: [{ id: 'occ-1', body: 'Atracação concluída.', department: 'operacoes', author_id: 'user-1', created_at: '2026-07-19T10:00:00Z', section: null }],
      actor_names: { 'user-1': 'Ana Ribeiro' },
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  expect(screen.getByText('0/3 departamentos assinados')).toBeTruthy()
  expect(screen.getByText('Operações')).toBeTruthy()
  expect(screen.getByText('Documentação')).toBeTruthy()
  expect(screen.getByText('Equipamentos')).toBeTruthy()
  expect(screen.getByText(/Confirmado por Ana Ribeiro em 19\/07\/2026/)).toBeTruthy()
})

it('assina o departamento apenas quando habilitado e chama a RPC com o payload correto', () => {
  departmentSignoffMutateMock.mockClear()
  useAuthMock.mockReturnValue({ effectiveRole: 'equipamentos', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: ['veiculos', 'operacao_patio', 'vazios_embarcados'].map((section) => ({ id: section, section, state: 'confirmed' })),
      departmentSignoffs: [],
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const equipamentosCard = screen.getByText('Equipamentos').closest('div.app-panel')! as HTMLElement
  const signButton = within(equipamentosCard).getByRole('button', { name: 'Assinar' })
  expect((signButton as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(signButton)
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

  expect(departmentSignoffMutateMock).toHaveBeenCalledWith({
    voyageId: 7, port: 'BRVIX', department: 'equipamentos', signed: true, justification: undefined,
  })
})

it('desabilita assinar o departamento enquanto houver seção pendente', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'equipamentos', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: [{ id: 'veiculos', section: 'veiculos', state: 'confirmed' }],
      departmentSignoffs: [],
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const equipamentosCard = screen.getByText('Equipamentos').closest('div.app-panel')! as HTMLElement
  const signButton = within(equipamentosCard).getByRole('button', { name: 'Assinar' }) as HTMLButtonElement
  expect(signButton.disabled).toBe(true)
})

it('reabrir um sign-off departamental exige justificativa', () => {
  departmentSignoffMutateMock.mockClear()
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: allSectionsSignoffs(),
      departmentSignoffs: [{ id: 'ds-1', department: 'operacoes', signed_by: 'user-1', signed_at: '2026-07-20T09:00:00Z' }],
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const operacoesCard = screen.getByText('Operações').closest('div.app-panel')! as HTMLElement
  fireEvent.click(within(operacoesCard).getByRole('button', { name: 'Reabrir' }))
  const confirm = screen.getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Justificativa'), { target: { value: 'Correção necessária' } })
  expect(confirm.disabled).toBe(false)
  fireEvent.click(confirm)

  expect(departmentSignoffMutateMock).toHaveBeenCalledWith({
    voyageId: 7, port: 'BRVIX', department: 'operacoes', signed: false, justification: 'Correção necessária',
  })
})

it('fecha o ADR apenas quando os 3 departamentos assinaram e envia o snapshot exibido', () => {
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: allSectionsSignoffs(),
      departmentSignoffs: allDepartmentsSigned(),
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  expect(screen.getByText('3/3 departamentos assinados')).toBeTruthy()
  const closeButton = screen.getByRole('button', { name: 'Fechar ADR' })
  expect((closeButton as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(closeButton)
  expect(closeMutateMock).toHaveBeenCalledWith(expect.objectContaining({
    voyageId: 7,
    port: 'BRVIX',
    snapshot: expect.objectContaining({ sections: expect.any(Object) }),
  }))
})

it('mantém Fechar ADR desabilitado enquanto faltar algum departamento', () => {
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: allSectionsSignoffs(),
      departmentSignoffs: allDepartmentsSigned().slice(0, 2),
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  expect(screen.getByText('2/3 departamentos assinados')).toBeTruthy()
  const closeButton = screen.getByRole('button', { name: 'Fechar ADR' }) as HTMLButtonElement
  expect(closeButton.disabled).toBe(true)
})

it('exibe a carga solta derivada e a congela sob cargaSolta no snapshot', () => {
  const cargaSolta = { bls: 2, machines: 3, packages: 12, weightTon: 6, cbm: 20 }
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      cargaSolta,
      containers: [], vehicles: [], vaziosImp: [], granite: [], vaziosExp: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
    },
    isLoading: false,
    error: null,
  })
  useAgencyReportOwnMock.mockReturnValue({
    data: { terminal: 'TVV', signoffs: allSectionsSignoffs(), departmentSignoffs: allDepartmentsSigned(), occurrences: [] },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  expect(screen.getByText('Máquinas')).toBeTruthy()
  expect(screen.getByText('3')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Fechar ADR' }))
  expect(closeMutateMock).toHaveBeenCalledWith(expect.objectContaining({
    snapshot: expect.objectContaining({
      sections: expect.objectContaining({ cargaSolta }),
    }),
  }))
})

it('agrupa carga solta na seção de carga descarregada e assina granito como carga carregada', () => {
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      cargaSolta: { bls: 2, machines: 3, packages: 12, weightTon: 6, cbm: 20 },
      containers: [], vehicles: [], vaziosImp: [],
      granite: [{ blocks_qty: 5, real_weight_kg: 8_000 }],
      vaziosExp: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
    },
    isLoading: false,
    error: null,
  })
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: [
        { id: 'unload', section: 'carga_descarregada', state: 'confirmed' },
        { id: 'load', section: 'carga_carregada', state: 'nothing_to_declare' },
      ],
      departmentSignoffs: [],
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const dischargeSection = screen.getByRole('heading', { name: 'Carga descarregada' }).closest('section')
  const graniteSection = screen.getByRole('heading', { name: 'Granito (carga carregada)' }).closest('section')

  expect(dischargeSection).not.toBeNull()
  expect(graniteSection).not.toBeNull()
  expect(within(dischargeSection!).getByText('Carga solta')).toBeTruthy()
  expect(within(dischargeSection!).getByText('Confirmado')).toBeTruthy()
  expect(within(graniteSection!).getByText('Nada a declarar')).toBeTruthy()
})

it('destaca o IMO separado da contagem geral de containers descarregados', () => {
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [
        { size_type: '40HC', is_imo: false }, { size_type: '40HC', is_imo: true }, { size_type: '20GP', is_imo: false },
      ],
      vehicles: [], vaziosImp: [], granite: [], vaziosExp: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const dischargeSection = screen.getByRole('heading', { name: 'Carga descarregada' }).closest('section')!
  expect(within(dischargeSection).getByText('3')).toBeTruthy()
  expect(within(dischargeSection).getByText('IMO: 1')).toBeTruthy()
  expect(within(dischargeSection).getByText('Descarga de importação')).toBeTruthy()
})

it('renomeia Container com veículo para Veículos', () => {
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vaziosImp: [], granite: [], vaziosExp: [], storage: { containers: 0, days: 0 },
      vehicles: [{ brand: 'BYD', bl_id: 'bl-1', chassis: 'vin-1', container: { unpacking_location: 'Pátio Alfa' } }],
      operation: { os_number: null, service_qty: [] },
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  expect(screen.getByRole('heading', { name: 'Veículos' })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Container com veículo' })).toBeNull()
})

it('renderiza as 4 fases do ciclo, sem a fase Registro (ADR 0030)', () => {
  useAgencyReportDerivedMock.mockReturnValue({ data: undefined, isLoading: false, error: null })
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  expect(screen.getByRole('heading', { name: 'Escala', level: 2 })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Importação', level: 2 })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Operação de pátio', level: 2 })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Exportação', level: 2 })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Registro', level: 2 })).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Ocorrências' })).toBeNull()

  const embarqueSection = screen.getByRole('heading', { name: 'Vazios embarcados' }).closest('section')!
  expect(within(embarqueSection).queryByText('Storage')).toBeNull()
  expect(within(embarqueSection).queryByText('OS')).toBeNull()
})

it('agrupa Vazios embarcados junto de Operação de pátio; Exportação mostra só Granito; nenhuma seção mostra legenda-resumo', () => {
  useAgencyReportDerivedMock.mockReturnValue({ data: undefined, isLoading: false, error: null })
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const patioPhase = screen.getByRole('heading', { name: 'Operação de pátio', level: 2 }).closest('div')!
  expect(within(patioPhase).getByRole('heading', { name: 'Vazios embarcados' })).toBeTruthy()

  const exportacaoPhase = screen.getByRole('heading', { name: 'Exportação', level: 2 }).closest('div')!
  expect(within(exportacaoPhase).getByRole('heading', { name: 'Granito (carga carregada)' })).toBeTruthy()
  expect(within(exportacaoPhase).queryByRole('heading', { name: 'Vazios embarcados' })).toBeNull()

  for (const legend of [
    'Janela operacional da escala; dados confirmados por Operações.',
    'Storage, overtime, depots e serviços extra dos vazios de exportação — base da conferência de faturas de armazenagem e overtime pelo Financeiro.',
    'Containers vazios embarcados nesta escala, por tipo.',
  ]) {
    expect(screen.queryByText(legend)).toBeNull()
  }
})

it('congela locais de desova, depots e embarques diretos no snapshot', () => {
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      schedule: { ata: '2026-07-19', atb: '2026-07-19', atd: '2026-07-20', rtw: 2 },
      cargaSolta: { bls: 0, machines: 0, packages: 0, weightTon: 0, cbm: 0 },
      containers: [], vaziosImp: [], granite: [], storage: { containers: 1, days: 2 },
      vehicles: [{ brand: 'BYD', bl_id: 'bl-1', chassis: 'vin-1', container: { unpacking_location: 'Pátio Alfa' } }],
      vaziosExp: [
        { container_type: '40HC', local_id: 'vbr', condition: 'vazio', local: { id: 'vbr', code: 'VBR', name: 'VBR', tipo: 'depot' } },
        { container_type: '40HC', local_id: 'tvv', condition: 'vazio', local: { id: 'tvv', code: 'TVV', name: 'TVV', tipo: 'terminal_portuario' } },
      ],
      operation: { os_number: 'OS-42', service_qty: [] },
    },
    isLoading: false,
    error: null,
  })
  useAgencyReportOwnMock.mockReturnValue({
    data: { terminal: 'TVV', signoffs: allSectionsSignoffs(), departmentSignoffs: allDepartmentsSigned(), occurrences: [] },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  fireEvent.click(screen.getByRole('button', { name: 'Fechar ADR' }))
  expect(closeMutateMock).toHaveBeenCalledWith(expect.objectContaining({
    snapshot: expect.objectContaining({
      header: expect.objectContaining({ schedule: expect.objectContaining({ atb: '2026-07-19', rtw: 2 }) }),
      sections: expect.objectContaining({
        vehicleLocations: { BYD: ['Pátio Alfa'] },
        directEmbarkCount: 1,
        depots: ['VBR'],
      }),
    }),
  }))
})

it('exibe o autor resolvido e o documento estruturado quando o ADR está fechado', () => {
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      status: 'closed',
      closed_at: '2026-07-20T10:00:00Z',
      closed_by_name: 'Lucca F.',
      closed_snapshot: {
        header: { schedule: {} },
        sections: { cargaDescarregada: { rows: { '40HC': { carga_geral: 1 } }, totals: { carga_geral: 1 } } },
      },
      signoffs: [],
      departmentSignoffs: [],
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  expect(screen.getByRole('status').textContent).toContain('Fechado em')
  expect(screen.getByRole('status').textContent).toContain('Lucca F.')
  expect(screen.getByRole('table', { name: 'Matriz de descarga' })).toBeTruthy()
})

it('no estado fechado renderiza o documento e oculta controles/seções editáveis', () => {
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      status: 'closed',
      closed_at: '2026-07-20T10:00:00Z',
      closed_by_name: 'Lucca F.',
      closed_snapshot: { header: { schedule: {} }, sections: { cargaDescarregada: { rows: {}, totals: {} } }, occurrences: [], signoffs: [] },
      signoffs: [],
      departmentSignoffs: [],
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  expect(screen.getByRole('heading', { name: 'Matriz de descarga' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Fechar ADR' })).toBeNull()
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.getByRole('button', { name: 'Imprimir' })).toBeTruthy()
})

it('exibe Reabrir do ADR somente para administradores e exige justificativa não vazia', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'administrativo', isAdmin: true })
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      status: 'closed',
      closed_at: '2026-07-20T10:00:00Z',
      closed_snapshot: { header: { schedule: {} }, sections: { cargaDescarregada: { rows: {}, totals: {} } }, occurrences: [], signoffs: [] },
      signoffs: [], departmentSignoffs: [], occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)
  fireEvent.click(screen.getByRole('button', { name: 'Reabrir' }))
  const confirm = screen.getByRole('button', { name: 'Confirmar reabertura' }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } })
  expect(confirm.disabled).toBe(true)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Correção necessária' } })
  expect(confirm.disabled).toBe(false)
  fireEvent.click(confirm)
  expect(reopenMutateMock).toHaveBeenCalledWith({ voyageId: 7, port: 'BRVIX', justification: 'Correção necessária' }, expect.any(Object))
})

it('não exibe Reabrir do ADR para usuário não administrador', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      status: 'closed',
      closed_snapshot: { header: { schedule: {} }, sections: { cargaDescarregada: { rows: {}, totals: {} } }, occurrences: [], signoffs: [] },
      signoffs: [], departmentSignoffs: [], occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)
  expect(screen.queryByRole('button', { name: 'Reabrir' })).toBeNull()
})

it('a primeira saída de Pendente só pede confirmação, sem justificativa', () => {
  signoffMutateMock.mockClear()
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const datasSection = screen.getByRole('heading', { name: 'Cabeçalho' }).closest('section')!
  fireEvent.click(within(datasSection).getByRole('button', { name: 'Confirmado' }))

  expect(screen.queryByLabelText('Justificativa')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

  expect(signoffMutateMock).toHaveBeenCalledWith({
    voyageId: 7, port: 'BRVIX', section: 'datas', state: 'confirmed', justification: undefined,
  })
})

it('alterar uma decisão já registrada exige justificativa não vazia', () => {
  signoffMutateMock.mockClear()
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({
    data: { terminal: 'TVV', signoffs: [{ id: 'so-1', section: 'datas', state: 'confirmed' }], departmentSignoffs: [], occurrences: [] },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const datasSection = screen.getByRole('heading', { name: 'Cabeçalho' }).closest('section')!
  fireEvent.click(within(datasSection).getByRole('button', { name: 'Nada a declarar' }))

  const justificationField = screen.getByLabelText('Justificativa')
  const confirmButton = screen.getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement
  expect(confirmButton.disabled).toBe(true)

  fireEvent.change(justificationField, { target: { value: '  ' } })
  expect(confirmButton.disabled).toBe(true)

  fireEvent.change(justificationField, { target: { value: 'Correção após revisão' } })
  expect(confirmButton.disabled).toBe(false)
  fireEvent.click(confirmButton)

  expect(signoffMutateMock).toHaveBeenCalledWith({
    voyageId: 7, port: 'BRVIX', section: 'datas', state: 'nothing_to_declare', justification: 'Correção após revisão',
  })
})

it('sem eventos, não exibe o ícone de histórico', () => {
  useAgencyReportSignoffEventsMock.mockReturnValue({ data: [] })
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const datasSection = screen.getByRole('heading', { name: 'Cabeçalho' }).closest('section')!
  expect(within(datasSection).queryByTitle('Ver histórico')).toBeNull()
})

it('com eventos, o histórico lista de→para, autor e justificativa', () => {
  useAgencyReportSignoffEventsMock.mockReturnValue({
    data: [{
      id: 1,
      section: 'datas',
      old_value: 'confirmed',
      new_value: 'nothing_to_declare',
      justification: 'Correção após revisão',
      changed_by: 'user-1',
      changed_at: '2026-07-20T10:00:00Z',
    }],
  })
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: [{ id: 'so-1', section: 'datas', state: 'nothing_to_declare' }],
      departmentSignoffs: [],
      occurrences: [],
      actor_names: { 'user-1': 'Ana Ribeiro' },
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const datasSection = screen.getByRole('heading', { name: 'Cabeçalho' }).closest('section')!
  fireEvent.click(within(datasSection).getByTitle('Ver histórico'))

  expect(screen.getByText('Confirmado → Nada a declarar')).toBeTruthy()
  expect(screen.getByText(/Ana Ribeiro/)).toBeTruthy()
  expect(screen.getByText('Correção após revisão')).toBeTruthy()
})

it('mostra o campo de Observação em cada seção, editável só pelo dono', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'equipamentos', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: [
        { id: 'veiculos', section: 'veiculos', state: 'pending', observation: 'Container avariado no pátio.' },
        { id: 'datas', section: 'datas', state: 'pending', observation: null },
      ],
      departmentSignoffs: [],
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  // Dono da seção (Equipamentos → veículos): campo editável, valor preenchido.
  const veiculosSection = screen.getByRole('heading', { name: 'Veículos' }).closest('section')!
  const veiculosObservation = within(veiculosSection).getByLabelText('Observação — Veículos') as HTMLTextAreaElement
  expect(veiculosObservation.tagName).toBe('TEXTAREA')
  expect(veiculosObservation.value).toBe('Container avariado no pátio.')

  // Seção de outro departamento (Operações → datas): só leitura, sem valor.
  const datasSection = screen.getByRole('heading', { name: 'Cabeçalho' }).closest('section')!
  expect(within(datasSection).queryByLabelText('Observação — Cabeçalho')).toBeNull()
  expect(within(datasSection).getByText('—')).toBeTruthy()
})

it('sobrescrever a Observação não pede justificativa e chama a RPC de Observação', () => {
  observationMutateMock.mockClear()
  useAuthMock.mockReturnValue({ effectiveRole: 'equipamentos', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: [{ id: 'veiculos', section: 'veiculos', state: 'confirmed', observation: 'Nota antiga' }],
      departmentSignoffs: [],
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const veiculosSection = screen.getByRole('heading', { name: 'Veículos' }).closest('section')!
  const observationField = within(veiculosSection).getByLabelText('Observação — Veículos')
  fireEvent.change(observationField, { target: { value: 'Nota atualizada' } })
  fireEvent.blur(observationField)

  expect(screen.queryByLabelText('Justificativa')).toBeNull()
  expect(observationMutateMock).toHaveBeenCalledWith({
    voyageId: 7, port: 'BRVIX', section: 'veiculos', observation: 'Nota atualizada',
  })
})

it('sign-off de Operações não é mais bloqueado por Ocorrências (1 seção: datas)', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: [{ id: 'datas', section: 'datas', state: 'confirmed' }],
      departmentSignoffs: [],
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const operacoesCard = screen.getByText('Operações').closest('div.app-panel')! as HTMLElement
  const signButton = within(operacoesCard).getByRole('button', { name: 'Assinar' }) as HTMLButtonElement
  expect(signButton.disabled).toBe(false)
})

it('marca com o chip "Omitida" a escala omitida que só entrou na lista por ter ADR fechado', () => {
  useAgencyReportOwnMock.mockReturnValue({ data: undefined })
  render(
    <VoyageAgencyReportTab
      voyageId={7}
      voyageLabel="NAVIO TESTE / 01E"
      carrierName="Armador teste"
      pods={[{ pod: 'BRVIX', omitted: false }, { pod: 'BRSSA', omitted: true }]}
    />,
  )

  const activeButton = screen.getByRole('button', { name: 'BRVIX' })
  expect(within(activeButton).queryByText('Omitida')).toBeNull()

  const omittedButton = screen.getByRole('button', { name: /BRSSA/ })
  expect(within(omittedButton).getByText('Omitida')).toBeTruthy()
})

it('escala omitida com ADR fechado continua acessível: abre pelo deep-link e renderiza o snapshot fechado', () => {
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      status: 'closed',
      closed_at: '2026-07-20T10:00:00Z',
      closed_by_name: 'Lucca F.',
      closed_snapshot: {
        header: { schedule: {} },
        sections: { cargaDescarregada: { rows: { '40HC': { carga_geral: 1 } }, totals: { carga_geral: 1 } } },
      },
      signoffs: [],
      departmentSignoffs: [],
      occurrences: [],
    },
  })

  render(
    <VoyageAgencyReportTab
      voyageId={7}
      voyageLabel="NAVIO TESTE / 01E"
      carrierName="Armador teste"
      pods={[{ pod: 'BRVIX', omitted: false }, { pod: 'BRSSA', omitted: true }]}
      initialEscala="BRSSA"
    />,
  )

  expect(screen.getByRole('button', { name: /BRSSA/ }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('status').textContent).toContain('Fechado em')
  expect(screen.getByRole('table', { name: 'Matriz de descarga' })).toBeTruthy()
})

// Task 4 do ADR 2026-07-31: a listagem do operado substitui a matriz com
// zeros. As três verificações pedidas pelo plano seguem abaixo.

it('escala sem carga solta não renderiza o bloco "Carga solta" nem a seção inteira quando também não há containers', () => {
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vehicles: [], vaziosImp: [], granite: [], vaziosExp: [],
      storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
      // sem cargaSolta.bls: não há carga solta nesta escala
      cargaSolta: { bls: 0, machines: 0, packages: 0, weightTon: 0, cbm: 0 },
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const dischargeSection = screen.getByRole('heading', { name: 'Carga descarregada' }).closest('section')!
  expect(within(dischargeSection).queryByText('Carga solta')).toBeNull()
  expect(within(dischargeSection).getByText('Nada operado nesta escala.')).toBeTruthy()
})

it('combinação inexistente não vira linha na listagem do operado — só o que ocorreu aparece', () => {
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [
        { size_type: '40HC', is_imo: false, category: 'carga_geral' },
        { size_type: '40HC', is_imo: false, category: 'carga_geral' },
      ],
      vehicles: [], vaziosImp: [], granite: [], vaziosExp: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const dischargeSection = screen.getByRole('heading', { name: 'Carga descarregada' }).closest('section')!
  expect(within(dischargeSection).getByText('40HC · carga_geral')).toBeTruthy()
  expect(within(dischargeSection).queryByText(/20GP/)).toBeNull()
  expect(within(dischargeSection).queryByText(/imo/)).toBeNull()
  expect(within(dischargeSection).queryByText(/veiculos/)).toBeNull()
})

it('seção vazia continua Pendente com o controle de resolução visível', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'documentacao', isAdmin: false })
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vehicles: [], vaziosImp: [], granite: [], vaziosExp: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
    },
    isLoading: false,
    error: null,
  })
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const dischargeSection = screen.getByRole('heading', { name: 'Carga descarregada' }).closest('section')!
  expect(within(dischargeSection).getByText('Nada operado nesta escala.')).toBeTruthy()
  expect(within(dischargeSection).getByText('Pendente')).toBeTruthy()
  expect(within(dischargeSection).getByRole('button', { name: 'Confirmado' })).toBeTruthy()
  expect(within(dischargeSection).getByRole('button', { name: 'Nada a declarar' })).toBeTruthy()
})

it('veículos sem VIN e vazios embarcados sem booking somem, mostrando "nada operado nesta escala"', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vehicles: [], vaziosImp: [], granite: [], vaziosExp: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const veiculosSection = screen.getByRole('heading', { name: 'Veículos' }).closest('section')!
  expect(within(veiculosSection).getByText('Nada operado nesta escala.')).toBeTruthy()

  const embarqueSection = screen.getByRole('heading', { name: 'Vazios embarcados' }).closest('section')!
  expect(within(embarqueSection).getByText('Nada operado nesta escala.')).toBeTruthy()
})

it('agrupa vazios embarcados por tipo, condição e local de origem — uma linha por combinação', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vehicles: [], vaziosImp: [], granite: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
      vaziosExp: [
        { container_type: '40HC', local_id: 'vbr', condition: 'vazio', local: { id: 'vbr', code: 'VBR', name: 'VBR', tipo: 'depot' } },
        { container_type: '40HC', local_id: 'vbr', condition: 'vazio', local: { id: 'vbr', code: 'VBR', name: 'VBR', tipo: 'depot' } },
        { container_type: '40HC', local_id: 'vbr', condition: 'material', local: { id: 'vbr', code: 'VBR', name: 'VBR', tipo: 'depot' } },
      ],
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const embarqueSection = screen.getByRole('heading', { name: 'Vazios embarcados' }).closest('section')!
  expect(within(embarqueSection).getByText('40HC · EMPTY · VBR')).toBeTruthy()
  expect(within(embarqueSection).getByText('40HC · EMPTY W/ MATERIAL · VBR')).toBeTruthy()
  const quantities = within(embarqueSection).getAllByText('2')
  expect(quantities.length).toBeGreaterThan(0)
})

it('exibe o aviso de containers cheios órfãos e de divergência de vazios descarregados', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [{ size_type: '40HC', is_imo: false, category: 'carga_geral' }],
      vehicles: [], granite: [], vaziosExp: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
      vaziosImp: [{ container_type: '40HC', natureza: 'cama' }],
      dischargeDivergence: { orphanFullContainers: 2 },
      vaziosDivergence: { baplieCount: 5, moduleCount: 3, unclassifiedCount: 1, diverges: true },
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  expect(screen.getByText(/2 container\(s\) cheio\(s\) no Baplie sem B\/L correspondente/)).toBeTruthy()
  expect(screen.getByText(/Baplie aponta 5 vazio\(s\) descarregado\(s\) contra 3/)).toBeTruthy()
  expect(screen.getByText(/1 ainda sem natureza classificada/)).toBeTruthy()
})

// Task 10 do ADR 2026-07-31: aviso de dado órfão — granito ou Embarque de
// Vazios lançado num porto que não é escala nenhuma da viagem.

it('verificação do plano: granito órfão em BRSSA aparece como aviso na escala BRVIX, não como seção zerada', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'documentacao', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vehicles: [], vaziosImp: [], vaziosExp: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
      granite: [],
      orphanData: { granito: [{ port: 'BRSSA', count: 3 }], vaziosEmbarcados: [] },
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const graniteSection = screen.getByRole('heading', { name: 'Granito (carga carregada)' }).closest('section')!
  expect(within(graniteSection).queryByText('Nada operado nesta escala.')).toBeNull()
  expect(within(graniteSection).getByText(/3 B\/L\(s\) de granito em BRSSA/)).toBeTruthy()
  expect(within(graniteSection).getByText(/porto não é escala desta viagem/)).toBeTruthy()
})

it('granito numa escala vizinha válida da mesma viagem não dispara o aviso de dado órfão', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'documentacao', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vehicles: [], vaziosImp: [], vaziosExp: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
      granite: [],
      orphanData: { granito: [], vaziosEmbarcados: [] },
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const graniteSection = screen.getByRole('heading', { name: 'Granito (carga carregada)' }).closest('section')!
  expect(within(graniteSection).getByText('Nada operado nesta escala.')).toBeTruthy()
  expect(within(graniteSection).queryByText(/porto não é escala desta viagem/)).toBeNull()
})

it('aviso de Embarque de Vazios órfão não bloqueia o sign-off da seção', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'equipamentos', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vehicles: [], vaziosImp: [], granite: [], vaziosExp: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
      orphanData: { granito: [], vaziosEmbarcados: [{ port: 'BRSSA', count: 4 }] },
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const embarqueSection = screen.getByRole('heading', { name: 'Vazios embarcados' }).closest('section')!
  expect(within(embarqueSection).queryByText('Nada operado nesta escala.')).toBeNull()
  expect(within(embarqueSection).getByText(/4 unidade\(s\) de vazios embarcados em BRSSA/)).toBeTruthy()
  expect(within(embarqueSection).getByRole('button', { name: 'Confirmado' })).toBeTruthy()
  expect(within(embarqueSection).getByRole('button', { name: 'Nada a declarar' })).toBeTruthy()
})
