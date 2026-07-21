// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { VoyageAgencyReportTab } from '../VoyageAgencyReportTab'

const { useAgencyReportDerivedMock, useAgencyReportOwnMock, closeMutateMock, reopenMutateMock, useAuthMock } = vi.hoisted(() => ({
  useAgencyReportDerivedMock: vi.fn(),
  useAgencyReportOwnMock: vi.fn(),
  closeMutateMock: vi.fn(),
  reopenMutateMock: vi.fn(),
  useAuthMock: vi.fn(),
}))

const { signoffMutateMock, departmentSignoffMutateMock, occurrenceMutateMock, useAgencyReportSignoffEventsMock } = vi.hoisted(() => ({
  signoffMutateMock: vi.fn(),
  departmentSignoffMutateMock: vi.fn(),
  occurrenceMutateMock: vi.fn(),
  useAgencyReportSignoffEventsMock: vi.fn(),
}))

vi.mock('../../../hooks/useAgencyReport', () => ({
  useAgencyReportDerived: useAgencyReportDerivedMock,
  useAgencyReportOwn: useAgencyReportOwnMock,
  useAgencyReportSignoffEvents: useAgencyReportSignoffEventsMock,
  useSetAgencyReportSignoff: () => ({ mutate: signoffMutateMock, isPending: false }),
  useSetAgencyReportDepartmentSignoff: () => ({ mutate: departmentSignoffMutateMock, isPending: false }),
  useAddAgencyReportOccurrence: () => ({ mutate: occurrenceMutateMock }),
  useSetAgencyReportTerminal: () => ({ mutate: vi.fn() }),
  useCloseAgencyReport: () => ({ mutate: closeMutateMock, isPending: false }),
  useReopenAgencyReport: () => ({ mutate: reopenMutateMock, isPending: false }),
}))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: useAuthMock }))

const ALL_SECTIONS = [
  'datas', 'carga_descarregada', 'carga_carregada', 'veiculos',
  'vazios_embarcados', 'vazios_descarregados', 'ocorrencias', 'operacao_patio',
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
      pods={['BRVIX', 'BRRIO']}
      initialEscala="BRRIO"
    />,
  )

  expect(screen.getByRole('button', { name: 'BRRIO' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'BRVIX' }))
  expect(screen.getByRole('button', { name: 'BRVIX' }).getAttribute('aria-pressed')).toBe('true')
})

it('exibe o percentual de overtime por depot da operação derivada, na fase Operação de pátio', () => {
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vehicles: [], vaziosImp: [], granite: [], vaziosExp: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, reorg: [], overtime: [{ id: 'ot-1', depot: 'VBR', percent: 25 }] },
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={['BRVIX']} />)

  const patioSection = screen.getByRole('heading', { name: 'Operação de pátio', level: 3 }).closest('section')!
  expect(within(patioSection).getByText('VBR')).toBeTruthy()
  expect(within(patioSection).getByText('25%')).toBeTruthy()
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

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={['BRVIX']} />)

  expect(screen.getByText('0/3 departamentos assinados')).toBeTruthy()
  expect(screen.getByText('Operações')).toBeTruthy()
  expect(screen.getByText('Documentação')).toBeTruthy()
  expect(screen.getByText('Equipamentos')).toBeTruthy()
  expect(screen.getByText(/Confirmado por Ana Ribeiro em 19\/07\/2026/)).toBeTruthy()
  expect(screen.getByText('Atracação concluída.')).toBeTruthy()
  expect(screen.getByText(/Ana Ribeiro \(Operações\) · 19\/07\/2026/)).toBeTruthy()
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

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={['BRVIX']} />)

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

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={['BRVIX']} />)

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

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={['BRVIX']} />)

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

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={['BRVIX']} />)

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

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={['BRVIX']} />)

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
      operation: { os_number: null, reorg: [], overtime: [] },
    },
    isLoading: false,
    error: null,
  })
  useAgencyReportOwnMock.mockReturnValue({
    data: { terminal: 'TVV', signoffs: allSectionsSignoffs(), departmentSignoffs: allDepartmentsSigned(), occurrences: [] },
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

it('agrupa carga solta na seção de carga descarregada e assina granito como carga carregada', () => {
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      cargaSolta: { bls: 2, machines: 3, packages: 12, weightTon: 6, cbm: 20 },
      containers: [], vehicles: [], vaziosImp: [],
      granite: [{ blocks_qty: 5, real_weight_kg: 8_000 }],
      vaziosExp: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, reorg: [], overtime: [] },
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

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={['BRVIX']} />)

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
      operation: { os_number: null, reorg: [], overtime: [] },
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={['BRVIX']} />)

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
      operation: { os_number: null, reorg: [], overtime: [] },
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={['BRVIX']} />)

  expect(screen.getByRole('heading', { name: 'Veículos' })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Container com veículo' })).toBeNull()
})

it('renderiza as 5 fases do ciclo, com Operação de pátio como seção própria', () => {
  useAgencyReportDerivedMock.mockReturnValue({ data: undefined, isLoading: false, error: null })
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={['BRVIX']} />)

  expect(screen.getByRole('heading', { name: 'Escala', level: 2 })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Importação', level: 2 })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Operação de pátio', level: 2 })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Exportação', level: 2 })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Registro', level: 2 })).toBeTruthy()

  const embarqueSection = screen.getByRole('heading', { name: 'Vazios embarcados' }).closest('section')!
  expect(within(embarqueSection).queryByText('Storage')).toBeNull()
  expect(within(embarqueSection).queryByText('OS')).toBeNull()
})

it('congela locais de desova, depots e embarques diretos no snapshot', () => {
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      schedule: { ata: '2026-07-19', atb: '2026-07-19', atd: '2026-07-20', rtw: 2 },
      cargaSolta: { bls: 0, machines: 0, packages: 0, weightTon: 0, cbm: 0 },
      containers: [], vaziosImp: [], granite: [], storage: { containers: 1, days: 2 },
      vehicles: [{ brand: 'BYD', bl_id: 'bl-1', chassis: 'vin-1', container: { unpacking_location: 'Pátio Alfa' } }],
      vaziosExp: [
        { container_type: '40HC', depot: 'VBR', overtime_handling: false, overtime_transport: false },
        { container_type: '40HC', depot: null, overtime_handling: false, overtime_transport: false },
      ],
      operation: { os_number: 'OS-42', reorg: [], overtime: [] },
    },
    isLoading: false,
    error: null,
  })
  useAgencyReportOwnMock.mockReturnValue({
    data: { terminal: 'TVV', signoffs: allSectionsSignoffs(), departmentSignoffs: allDepartmentsSigned(), occurrences: [] },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={['BRVIX']} />)

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

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={['BRVIX']} />)

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

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={['BRVIX']} />)

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

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={['BRVIX']} />)
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

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={['BRVIX']} />)
  expect(screen.queryByRole('button', { name: 'Reabrir' })).toBeNull()
})

it('a primeira saída de Pendente só pede confirmação, sem justificativa', () => {
  signoffMutateMock.mockClear()
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={['BRVIX']} />)

  const ocorrenciasSection = screen.getByRole('heading', { name: 'Ocorrências' }).closest('section')!
  fireEvent.click(within(ocorrenciasSection).getByRole('button', { name: 'Confirmado' }))

  expect(screen.queryByLabelText('Justificativa')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

  expect(signoffMutateMock).toHaveBeenCalledWith({
    voyageId: 7, port: 'BRVIX', section: 'ocorrencias', state: 'confirmed', justification: undefined,
  })
})

it('alterar uma decisão já registrada exige justificativa não vazia', () => {
  signoffMutateMock.mockClear()
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({
    data: { terminal: 'TVV', signoffs: [{ id: 'so-1', section: 'datas', state: 'confirmed' }], departmentSignoffs: [], occurrences: [] },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={['BRVIX']} />)

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

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={['BRVIX']} />)

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

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={['BRVIX']} />)

  const datasSection = screen.getByRole('heading', { name: 'Cabeçalho' }).closest('section')!
  fireEvent.click(within(datasSection).getByTitle('Ver histórico'))

  expect(screen.getByText('Confirmado → Nada a declarar')).toBeTruthy()
  expect(screen.getByText(/Ana Ribeiro/)).toBeTruthy()
  expect(screen.getByText('Correção após revisão')).toBeTruthy()
})

it('qualquer departamento pode lançar ocorrência, com tag opcional de seção', () => {
  occurrenceMutateMock.mockClear()
  useAuthMock.mockReturnValue({ effectiveRole: 'equipamentos', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={['BRVIX']} />)

  fireEvent.change(screen.getByLabelText('Nova ocorrência'), { target: { value: 'Container avariado no pátio.' } })
  fireEvent.change(screen.getByLabelText('Seção da ocorrência'), { target: { value: 'operacao_patio' } })
  fireEvent.click(screen.getByRole('button', { name: 'Lançar' }))

  expect(occurrenceMutateMock).toHaveBeenCalledWith(
    { voyageId: 7, port: 'BRVIX', body: 'Container avariado no pátio.', section: 'operacao_patio' },
    expect.any(Object),
  )
})

it('financeiro não vê o formulário de lançamento de ocorrência', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'financeiro', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={['BRVIX']} />)

  expect(screen.queryByLabelText('Nova ocorrência')).toBeNull()
})
