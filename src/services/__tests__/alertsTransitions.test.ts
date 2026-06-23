import { beforeEach, expect, it, vi } from 'vitest'
import { acknowledgeAlert, closeAlert } from '../alerts'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { from: fromMock } }))

function updateResult(data: unknown, error: unknown = null) {
  const builder = {
    update: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    select: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve({ data, error })),
  }
  return builder
}

beforeEach(() => { fromMock.mockReset() })

it('falha ao reconhecer quando o alerta ja mudou de estado', async () => {
  fromMock.mockReturnValue(updateResult(null))

  await expect(acknowledgeAlert(10)).rejects.toThrow(/estado foi alterado/i)
})

it('falha ao fechar quando o alerta ja esta fechado', async () => {
  fromMock.mockReturnValue(updateResult(null))

  await expect(closeAlert(11)).rejects.toThrow(/estado foi alterado/i)
})

it('confirma a transicao quando uma linha e retornada', async () => {
  fromMock.mockReturnValue(updateResult({ id: 12 }))

  await expect(acknowledgeAlert(12)).resolves.toBeUndefined()
})
