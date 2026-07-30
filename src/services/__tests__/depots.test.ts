import { describe, expect, it, vi } from 'vitest'

const rows = [{ id: 's1', natureza: 'armazenagem', depot_id: 'd1', condition: 'vazio', active: true, rate_brl: 10 }]
const eqActive = vi.fn().mockResolvedValue({ data: rows, error: null })
const eqNatureza = vi.fn().mockReturnValue({ eq: eqActive })
const select = vi.fn().mockReturnValue({ eq: eqNatureza })
const from = vi.fn().mockReturnValue({ select })
vi.mock('../supabase', () => ({ supabase: { from } }))

const { resolveDepot, listArmazenagemServices } = await import('../depots')

describe('Cadastro de Depot', () => {
  it('trata entrada vazia como Embarque Direto', async () => {
    await expect(resolveDepot('')).resolves.toBeNull()
    await expect(resolveDepot(null)).resolves.toBeNull()
  })
})

describe('listArmazenagemServices', () => {
  it('filtra por natureza armazenagem e serviço ativo, de todos os depots', async () => {
    const result = await listArmazenagemServices()
    expect(result).toEqual(rows)
    expect(from).toHaveBeenCalledWith('depot_services')
    expect(eqNatureza).toHaveBeenCalledWith('natureza', 'armazenagem')
    expect(eqActive).toHaveBeenCalledWith('active', true)
  })
})
