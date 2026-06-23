import { beforeEach, expect, it, vi } from 'vitest'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { from: fromMock } }))

import { deleteVoyage } from '../voyages'
import { deleteVoyagePodSchedule } from '../voyageRouteSchedules'

function countResult(count: number) {
  const value: Record<string, unknown> = {
    select: () => value,
    eq: () => value,
    range: () => value,
    then: (resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ count, error: null }).then(resolve, reject),
  }
  return value
}

beforeEach(() => {
  fromMock.mockReset()
})

it('US-215: exclui a viagem quando nao ha dependencias', async () => {
  const deleteEq = vi.fn(() => Promise.resolve({ error: null }))
  const deleteFn = vi.fn(() => ({ eq: deleteEq }))
  fromMock.mockImplementation((table: string) => {
    if (table === 'voyages') return { delete: deleteFn }
    return countResult(0)
  })

  await expect(deleteVoyage(1)).resolves.toBeUndefined()
  expect(deleteFn).toHaveBeenCalledTimes(1)
  expect(deleteEq).toHaveBeenCalledWith('id', 1)
})

it('US-215: bloqueia a exclusao quando ha B/Ls vinculados', async () => {
  const deleteFn = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) }))
  fromMock.mockImplementation((table: string) => {
    if (table === 'voyages') return { delete: deleteFn }
    if (table === 'bls') return countResult(2)
    return countResult(0)
  })

  await expect(deleteVoyage(1)).rejects.toThrow(/Nao e possivel excluir esta viagem/)
  expect(deleteFn).not.toHaveBeenCalled()
})

it('US-218: exclusao de POD grava evento insert-only deleted=true', async () => {
  const insertFn = vi.fn(() => Promise.resolve({ error: null }))
  fromMock.mockImplementation(() => ({ insert: insertFn }))

  await deleteVoyagePodSchedule({ voyageId: 5, pod: 'brvit', changedBy: 'user-1' })

  expect(fromMock).toHaveBeenCalledWith('audit_logs')
  expect(insertFn).toHaveBeenCalledTimes(1)
  const [rows] = insertFn.mock.calls[0] as unknown as [Array<Record<string, unknown>>]
  expect(rows[0]).toMatchObject({
    entity_type: 'voyage_pod_schedule',
    field_name: 'deleted',
    old_value: 'false',
    new_value: 'true',
    changed_by: 'user-1',
  })
  expect(String(rows[0].entity_id)).toMatch(/^5::/)
})
