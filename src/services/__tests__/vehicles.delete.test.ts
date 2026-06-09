import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteVehicles } from '../vehicles'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('../supabase', () => ({ supabase: { from: mockFrom } }))

beforeEach(() => {
  mockFrom.mockReset()
})

describe('deleteVehicles', () => {
  it('apaga os veiculos informados via .delete().in()', async () => {
    const inMock = vi.fn(() => Promise.resolve({ error: null }))
    const deleteMock = vi.fn(() => ({ in: inMock }))
    mockFrom.mockReturnValue({ delete: deleteMock })

    await deleteVehicles([1, 2])

    expect(mockFrom).toHaveBeenCalledWith('vehicles')
    expect(inMock).toHaveBeenCalledWith('id', [1, 2])
  })

  it('nao chama o banco quando a lista esta vazia', async () => {
    await deleteVehicles([])
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('registra a exclusao em audit_logs quando ha autor', async () => {
    const auditInsert = vi.fn(() => Promise.resolve({ error: null }))
    mockFrom.mockImplementation((table: string) => {
      if (table === 'vehicles') return { delete: () => ({ in: () => Promise.resolve({ error: null }) }) }
      if (table === 'audit_logs') return { insert: auditInsert }
      throw new Error(`tabela nao mockada: ${table}`)
    })

    await deleteVehicles([1, 2], 'user-9')

    expect(auditInsert).toHaveBeenCalledTimes(1)
    expect(auditInsert.mock.calls[0][0]).toHaveLength(2)
  })

  it('propaga erro do banco', async () => {
    const inMock = vi.fn(() => Promise.resolve({ error: new Error('db down') }))
    mockFrom.mockReturnValue({ delete: () => ({ in: inMock }) })

    await expect(deleteVehicles([1])).rejects.toThrow('db down')
  })
})
