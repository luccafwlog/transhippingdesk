import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  setContainerUnpackingLocation,
  setVazioImportacaoNatureza,
  setVaziosImportacaoNaturezaMany,
} from '../vaziosNatureza'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('../supabase', () => ({ supabase: { from: mockFrom } }))

beforeEach(() => {
  mockFrom.mockReset()
})

describe('vaziosNatureza', () => {
  it('atualiza a natureza do vazio descarregado', async () => {
    const eq = vi.fn(() => Promise.resolve({ error: null }))
    const update = vi.fn(() => ({ eq }))
    mockFrom.mockReturnValue({ update })

    await setVazioImportacaoNatureza('empty-1', 'cover_plate')

    expect(mockFrom).toHaveBeenCalledWith('vazios_importacao_containers')
    expect(update).toHaveBeenCalledWith({ natureza: 'cover_plate' })
    expect(eq).toHaveBeenCalledWith('id', 'empty-1')
  })

  it('atualiza a natureza de múltiplos vazios em lote com chunking', async () => {
    const inMock = vi.fn(() => Promise.resolve({ error: null }))
    const update = vi.fn(() => ({ in: inMock }))
    mockFrom.mockReturnValue({ update })

    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`)
    await setVaziosImportacaoNaturezaMany(ids, 'cama')

    expect(mockFrom).toHaveBeenCalledWith('vazios_importacao_containers')
    expect(update).toHaveBeenCalledWith({ natureza: 'cama' })
    expect(inMock).toHaveBeenCalledTimes(2)
    expect(inMock).toHaveBeenNthCalledWith(1, 'id', ids.slice(0, 200))
    expect(inMock).toHaveBeenNthCalledWith(2, 'id', ids.slice(200))
  })

  it('não dispara queries se lista de IDs estiver vazia', async () => {
    await setVaziosImportacaoNaturezaMany([], 'cama')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('atualiza o local de desova no container compartilhado', async () => {
    const eq = vi.fn(() => Promise.resolve({ error: null }))
    const update = vi.fn(() => ({ eq }))
    mockFrom.mockReturnValue({ update })

    await setContainerUnpackingLocation(42, 'Pátio 3')

    expect(mockFrom).toHaveBeenCalledWith('bl_containers')
    expect(update).toHaveBeenCalledWith({ unpacking_location: 'Pátio 3' })
    expect(eq).toHaveBeenCalledWith('id', 42)
  })

  it('propaga erro de persistência', async () => {
    mockFrom.mockReturnValue({
      update: () => ({ eq: () => Promise.resolve({ error: new Error('db down') }) }),
    })

    await expect(setVazioImportacaoNatureza('empty-1', 'cama')).rejects.toThrow('db down')
  })
})

