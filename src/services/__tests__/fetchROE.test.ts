// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { reportBestEffortFailure } = vi.hoisted(() => ({ reportBestEffortFailure: vi.fn() }))
vi.mock('../../lib/telemetry', () => ({ reportBestEffortFailure }))

import { fetchROE } from '../demurrage/demurrageKpis'

const ROE_CACHE_KEY = 'demurrage_roe_cache'

function okResponse(cotacaoVenda: string) {
  return {
    ok: true,
    json: () => Promise.resolve({ value: [{ cotacaoVenda }] }),
  } as unknown as Response
}

afterEach(() => {
  vi.restoreAllMocks()
  reportBestEffortFailure.mockClear()
  localStorage.clear()
})

describe('fetchROE', () => {
  beforeEach(() => localStorage.clear())

  it('não registra falha best-effort quando o BCB responde', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(okResponse('5.0000'))))

    const result = await fetchROE()

    expect(result.source).toBe('bcb_live')
    expect(result.offline).toBe(false)
    expect(reportBestEffortFailure).not.toHaveBeenCalled()
  })

  it('registra a queda do BCB e cai para o cache quando disponível', async () => {
    localStorage.setItem(ROE_CACHE_KEY, JSON.stringify({ roe: 5.32, fetchedAt: '2026-06-20T00:00:00.000Z' }))
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))))

    const result = await fetchROE()

    expect(result).toEqual({ roe: 5.32, offline: true, cachedAt: '2026-06-20T00:00:00.000Z', source: 'cached' })
    expect(reportBestEffortFailure).toHaveBeenCalledTimes(1)
    const [context, error, meta] = reportBestEffortFailure.mock.calls[0]
    expect(context).toBe('fetchROE: BCB PTAX indisponivel')
    expect((error as Error).message).toBe('network down')
    expect(meta).toEqual({ fellBackToCache: true })
  })

  it('registra a falha mesmo sem cache antes de propagar o erro', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 503 } as Response)))

    await expect(fetchROE()).rejects.toThrow('BCB offline e sem cache de PTAX disponivel')
    expect(reportBestEffortFailure).toHaveBeenCalledTimes(1)
    expect(reportBestEffortFailure.mock.calls[0][2]).toEqual({ fellBackToCache: false })
  })
})
