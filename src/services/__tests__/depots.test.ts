import { describe, expect, it } from 'vitest'
import { resolveDepot } from '../depots'

describe('Cadastro de Depot', () => {
  it('trata entrada vazia como Embarque Direto', async () => {
    await expect(resolveDepot('')).resolves.toBeNull()
    await expect(resolveDepot(null)).resolves.toBeNull()
  })
})
