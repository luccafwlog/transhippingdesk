import { describe, expect, it, vi } from 'vitest'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { from: fromMock } }))

import { listVoyageTerminalScaleStatesByVoyageIds } from '../voyageRouteSchedules'
import { projectLineUpTerminalDates } from '../lineup'

describe('listVoyageTerminalScaleStatesByVoyageIds', () => {
  it('resolve o codigo do terminal e ordena pelo codigo no empate de datas', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'voyage_escala_terminal_state') {
        return {
          select: () => ({
            in: () => Promise.resolve({
              data: [
                // Mesma data: o desempate tem de sair do codigo, nao do UUID.
                { voyage_id: 1, port: 'BRVIX', terminal_id: 'uuid-a', terminal_etb: '2026-08-26', terminal_atb: null, terminal_etd: null, terminal_atd: null, terminal_rtw: null, revision: 1 },
                { voyage_id: 1, port: 'BRVIX', terminal_id: 'uuid-z', terminal_etb: '2026-08-26', terminal_atb: null, terminal_etd: null, terminal_atd: null, terminal_rtw: null, revision: 1 },
              ],
              error: null,
            }),
          }),
        }
      }
      if (table === 'depots') {
        return {
          select: () => ({
            in: () => Promise.resolve({
              data: [
                { id: 'uuid-a', code: 'TVV' },
                { id: 'uuid-z', code: 'PORTMAC' },
              ],
              error: null,
            }),
          }),
        }
      }
      throw new Error(`tabela inesperada: ${table}`)
    })

    const states = (await listVoyageTerminalScaleStatesByVoyageIds([1])).get(1) ?? []
    expect(states.map((state) => state.terminalCode)).toEqual(['PORTMAC', 'TVV'])
  })

  it('nao consulta depots quando so existe Atracacao TBC', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'voyage_escala_terminal_state') {
        return {
          select: () => ({
            in: () => Promise.resolve({
              data: [{ voyage_id: 2, port: 'BRVIX', terminal_id: null, terminal_etb: null, terminal_atb: null, terminal_etd: null, terminal_atd: null, terminal_rtw: null, revision: 1 }],
              error: null,
            }),
          }),
        }
      }
      throw new Error(`tabela inesperada: ${table}`)
    })

    const states = (await listVoyageTerminalScaleStatesByVoyageIds([2])).get(2) ?? []
    expect(states).toHaveLength(1)
    expect(states[0].terminalCode).toBeNull()
  })
})

describe('projectLineUpTerminalDates', () => {
  const terminalStates = [
    { terminalId: 't-tvv', terminalEtb: '2026-08-26', terminalAtb: '2026-08-26', terminalEtd: '2026-08-28', terminalAtd: '2026-08-29', terminalRtw: null },
    { terminalId: 't-portmac', terminalEtb: '2026-08-28', terminalAtb: '2026-08-29', terminalEtd: '2026-09-01', terminalAtd: null, terminalRtw: null },
  ]
  const fronts = [
    { sentido: 'importacao' as const, terminalId: 't-tvv' },
    { sentido: 'exportacao' as const, terminalId: 't-portmac' },
  ]

  it('a linha de importacao sai com o ATD do seu proprio terminal', () => {
    const dates = projectLineUpTerminalDates({ fronts, terminalStates, direction: 'importacao' })
    expect(dates.etb).toBe('2026-08-26')
    expect(dates.atd).toBe('2026-08-29')
    expect(dates.hasAssignedTerminal).toBe(true)
  })

  it('a linha de exportacao continua sem ATD enquanto o seu terminal nao desatracou', () => {
    const dates = projectLineUpTerminalDates({ fronts, terminalStates, direction: 'exportacao' })
    expect(dates.etb).toBe('2026-08-28')
    expect(dates.atd).toBeNull()
  })

  it('sentido com dois terminais so sai quando ambos desatracaram', () => {
    const twoTerminals = [
      { sentido: 'importacao' as const, terminalId: 't-tvv' },
      { sentido: 'importacao' as const, terminalId: 't-portmac' },
    ]
    expect(projectLineUpTerminalDates({ fronts: twoTerminals, terminalStates, direction: 'importacao' }).atd).toBeNull()
    const bothSailed = terminalStates.map((state) => ({ ...state, terminalAtd: state.terminalAtd ?? '2026-09-02' }))
    expect(projectLineUpTerminalDates({ fronts: twoTerminals, terminalStates: bothSailed, direction: 'importacao' }).atd).toBe('2026-09-02')
  })

  it('sem terminal atribuido devolve hasAssignedTerminal=false para o chamador recair na Escala', () => {
    const dates = projectLineUpTerminalDates({ fronts: [{ sentido: 'importacao', terminalId: null }], terminalStates, direction: 'importacao' })
    expect(dates.hasAssignedTerminal).toBe(false)
    expect(dates.atd).toBeNull()
  })
})
