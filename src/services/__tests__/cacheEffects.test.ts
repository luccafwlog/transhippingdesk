import { describe, expect, it, vi } from 'vitest'
import { afterBaplieImportado, afterEscalaAlterada, afterManifestoImportado, afterRotaAlterada, afterViagemAlterada } from '../cacheEffects'

function fakeQueryClient() {
  const invalidateQueries = vi.fn().mockResolvedValue(undefined)
  return { client: { invalidateQueries }, keys: () => invalidateQueries.mock.calls.map(([input]) => JSON.stringify(input.queryKey)) }
}

describe('cache effects', () => {
  it('invalidates the voyage superset and normalizes timeline id', async () => {
    const { client, keys } = fakeQueryClient()
    await afterViagemAlterada(client, { voyageId: 24 })
    expect(keys()).toEqual(expect.arrayContaining([
      ['voyages'], ['voyage-options'], ['voyage-pod-schedules'], ['bls'], ['containers'], ['dashboard'],
      ['voyage-timeline', '24'], ['lineup-tv-v3'], ['lineup-tv-display-v2'],
    ].map((key) => JSON.stringify(key))))
    expect(keys()).not.toContain(JSON.stringify(['voyage-timeline', 24]))
    expect(new Set(keys()).size).toBe(keys().length)
  })

  it('invalidates scale and route effects', async () => {
    const { client, keys } = fakeQueryClient()
    await afterEscalaAlterada(client, { voyageId: 24 })
    await afterRotaAlterada(client, { voyageId: 24 })
    expect(keys()).toEqual(expect.arrayContaining([
      ['voyage-export-schedules'], ['voyage-route-ce-masters'], ['voyage-timeline', '24'], ['lineup-tv-v3'],
    ].map((key) => JSON.stringify(key))))
  })

  it('preserves import keys', async () => {
    const { client, keys } = fakeQueryClient()
    await afterManifestoImportado(client, { voyageId: 24 })
    expect(keys()).toEqual(expect.arrayContaining([['bls'], ['voyages'], ['port-options']].map((key) => JSON.stringify(key))))
  })
})
