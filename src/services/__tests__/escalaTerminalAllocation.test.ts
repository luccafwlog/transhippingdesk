import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deriveAgencyReportSections,
  deriveOperationFronts,
  EscalaTerminalBlockedError,
  groupAgencyReportsByTerminal,
  saveEscalaTerminalState,
} from '../escalaTerminalAllocation'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))

vi.mock('../supabase', () => ({
  supabase: { rpc: rpcMock, from: vi.fn() },
}))
vi.mock('../voyageExportSchedules', () => ({ fetchExportSchedulesByVoyageIds: vi.fn() }))
vi.mock('../depots', () => ({ listDepots: vi.fn() }))
vi.mock('../voyageRouteSchedules', () => ({ listVoyageEscalaSchedulesByVoyageIds: vi.fn() }))

describe('escalaTerminalAllocation', () => {
  beforeEach(() => rpcMock.mockReset())

  it('preserva frente persistida mesmo quando a fonte operacional deixou de aparecer', () => {
    const fronts = deriveOperationFronts({
      existing: [{ id: 'front-1', sentido: 'importacao', modalidade: 'carga_cheia', terminalId: 'tvv', source: 'operational_data' }],
      exportSchedule: { temExportacao: true, hasGranite: true, hasEmpty: false },
    })

    expect(fronts.map((front) => `${front.sentido}:${front.modalidade}`)).toEqual([
      'exportacao:granito',
      'importacao:carga_cheia',
    ])
    expect(fronts.find((front) => front.modalidade === 'carga_cheia')).toMatchObject({ terminalId: 'tvv', hasData: true })
  })

  it('preserva terminal e identidade de frente quando a fonte operacional continua presente', () => {
    const fronts = deriveOperationFronts({
      existing: [
        { id: 'front-import', sentido: 'importacao', modalidade: 'carga_cheia', terminalId: 'tvv', source: 'operational_data' },
        { id: 'front-export', sentido: 'exportacao', modalidade: 'granito', terminalId: 'portmac', source: 'export_declaration' },
      ],
      importKinds: ['carga_cheia'],
      exportSchedule: { temExportacao: true, hasGranite: true, hasEmpty: false },
    })

    expect(fronts.find((front) => front.modalidade === 'carga_cheia')).toMatchObject({ id: 'front-import', terminalId: 'tvv' })
    expect(fronts.find((front) => front.modalidade === 'granito')).toMatchObject({ id: 'front-export', terminalId: 'portmac' })
  })

  it('projeta seção Nada operado para uma frente ausente de um ADR terminalizado', () => {
    const sections = deriveAgencyReportSections([
      { sentido: 'importacao', modalidade: 'carga_cheia', terminalId: 'tvv', source: 'operational_data', hasData: false, section: 'carga_descarregada' },
    ], 'vbr')
    expect(sections.find((section) => section.section === 'carga_descarregada')).toEqual({
      section: 'carga_descarregada', state: 'nothing_operated', fronts: [],
    })
  })

  it('agrupa quatro frentes em dois ADRs e mantém TBC fora dos dois', () => {
    const fronts = deriveOperationFronts({
      existing: [
        { sentido: 'importacao', modalidade: 'carga_cheia', terminalId: 'tvv', source: 'operational_data' },
        { sentido: 'importacao', modalidade: 'carga_solta', terminalId: 'tvv', source: 'operational_data' },
        { sentido: 'importacao', modalidade: 'vazio', terminalId: 'vbr', source: 'operational_data' },
        { sentido: 'exportacao', modalidade: 'granito', terminalId: 'vbr', source: 'export_declaration' },
      ],
    })
    const reports = groupAgencyReportsByTerminal([
      { reportId: 'adr-tvv', voyageId: 9, port: 'BRVIX', terminalId: 'tvv', terminal: 'TVV', status: 'open' },
      { reportId: 'adr-vbr', voyageId: 9, port: 'BRVIX', terminalId: 'vbr', terminal: 'VBR', status: 'open' },
    ], fronts)
    expect(reports[0].sections.find((section) => section.section === 'carga_descarregada')).toMatchObject({ state: 'operated', fronts: ['carga_cheia', 'carga_solta'] })
    expect(reports[1].sections.find((section) => section.section === 'vazios_descarregados')).toMatchObject({ state: 'operated', fronts: ['vazio'] })

    const tbc = deriveOperationFronts({ existing: [{ sentido: 'exportacao', modalidade: 'vazio', terminalId: null, source: 'export_declaration' }] })
    expect(tbc[0].terminalId).toBeNull()
    const reportInputs = reports.map((report) => ({ reportId: report.reportId, voyageId: report.voyageId, port: report.port, terminalId: report.terminalId, terminal: report.terminal, status: report.status }))
    expect(groupAgencyReportsByTerminal(reportInputs, tbc)[0].sections.every((section) => section.state === 'nothing_operated')).toBe(true)
  })

  it('mantém escala sem frentes como estado vazio, com todas as seções Nada operado', () => {
    expect(deriveOperationFronts({})).toEqual([])
    expect(deriveAgencyReportSections([], 'tvv').every((section) => section.state === 'nothing_operated')).toBe(true)
  })

  it('salva somente pela RPC transacional e traduz bloqueio de ADR fechado', async () => {
    rpcMock.mockResolvedValue({
      data: { blocked: true, revision: 4, fronts: [], terminals: [], closed_blockers: [{ terminal_code: 'TVV', report_id: 'report-1', reason: 'ADR fechado' }] },
      error: null,
    })

    await expect(saveEscalaTerminalState({
      voyageId: 9,
      port: 'BRVIX',
      expectedRevision: 3,
      fronts: [{ sentido: 'importacao', modalidade: 'carga_cheia', terminalId: 'terminal-1' }],
      terminals: [{ terminalId: 'terminal-1', atb: null, atd: null, restow: null }],
      exportExpectation: { tem_exportacao: false, granito: false, has_empty: false },
    })).rejects.toMatchObject({ code: 'ADR_CLOSED_BLOCKED' })

    expect(rpcMock).toHaveBeenCalledWith('save_voyage_escala_terminal_state', expect.objectContaining({
      p_voyage_id: 9,
      p_port: 'BRVIX',
      p_expected_revision: 3,
    }))
    expect(rpcMock).toHaveBeenCalledTimes(1)
  })

  it('retorna a revisão e invalida as superfícies quando a RPC confirma', async () => {
    rpcMock.mockResolvedValue({ data: { blocked: false, revision: 4, fronts: [], terminals: [], closed_blockers: [] }, error: null })
    const invalidateQueries = vi.fn()
    const result = await saveEscalaTerminalState({
      voyageId: 9,
      port: 'BRVIX',
      expectedRevision: 3,
      fronts: [],
      terminals: [],
      exportExpectation: { tem_exportacao: false, granito: false, has_empty: false },
      queryClient: { invalidateQueries },
    })

    expect(result.revision).toBe(4)
    expect(rpcMock.mock.calls[0][1].p_export_expectation).toEqual({ tem_exportacao: false, granito: false, has_empty: false })
    expect(rpcMock.mock.calls[0][1].p_export_expectation).not.toBeNull()
    expect(invalidateQueries).toHaveBeenCalled()
    expect(invalidateQueries.mock.calls.map(([input]) => input.queryKey[0])).toEqual(expect.arrayContaining([
      'voyage-escala-terminal', 'voyage-escala-schedules', 'voyage-timeline', 'agency-report', 'lineup-tv-v3', 'painel', 'tv',
    ]))
  })
})

it('expõe a classe de domínio para consumidores sem depender do texto do PostgREST', () => {
  const error = new EscalaTerminalBlockedError([{ reportId: 'r1', terminalId: 't1', terminalCode: 'TVV', reason: 'fechado' }])
  expect(error).toMatchObject({ name: 'EscalaTerminalBlockedError', code: 'ADR_CLOSED_BLOCKED', blockers: [{ terminalCode: 'TVV' }] })
  expect(error.message).toContain('Reabra o ADR')
})
