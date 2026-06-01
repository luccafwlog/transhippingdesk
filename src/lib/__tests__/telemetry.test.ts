import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportBestEffortFailure } from '../telemetry'

afterEach(() => vi.restoreAllMocks())

describe('reportBestEffortFailure', () => {
  it('loga um warning estruturado sem lançar', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() =>
      reportBestEffortFailure('criar alerta', new Error('boom'), { type: 'overdue' }),
    ).not.toThrow()

    expect(warn).toHaveBeenCalledTimes(1)
    const [label, detail] = warn.mock.calls[0]
    expect(label).toBe('[best-effort] criar alerta')
    expect(detail).toMatchObject({
      type: 'overdue',
      error: { name: 'Error', message: 'boom' },
    })
  })

  it('normaliza erros do PostgREST (message/code)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    reportBestEffortFailure('persistir', { message: 'duplicate key', code: '23505' })
    expect(warn.mock.calls[0][1]).toMatchObject({
      error: { message: 'duplicate key', code: '23505' },
    })
  })

  it('aceita ausência de metadados', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => reportBestEffortFailure('ctx', 'falha textual')).not.toThrow()
    expect(warn.mock.calls[0][1]).toMatchObject({ error: 'falha textual' })
  })
})
