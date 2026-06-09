import { beforeEach, describe, expect, it, vi } from 'vitest'
import { logDeletions } from '../deleteAudit'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('../supabase', () => ({ supabase: { from: mockFrom } }))
vi.mock('../../lib/telemetry', () => ({ reportBestEffortFailure: vi.fn() }))

beforeEach(() => {
  mockFrom.mockReset()
})

describe('logDeletions', () => {
  it('grava uma linha por id em audit_logs com o autor', async () => {
    const insert = vi.fn(() => Promise.resolve({ error: null }))
    mockFrom.mockReturnValue({ insert })

    await logDeletions('bl', ['BL1', 'BL2'], 'user-123')

    expect(mockFrom).toHaveBeenCalledWith('audit_logs')
    const payload = insert.mock.calls[0][0]
    expect(payload).toHaveLength(2)
    expect(payload[0]).toMatchObject({
      entity_type: 'bl',
      entity_id: 'BL1',
      field_name: 'deleted',
      changed_by: 'user-123',
    })
  })

  it('nao grava nada quando nao ha autor', async () => {
    await logDeletions('vehicle', [1, 2], null)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('nao grava nada quando a lista esta vazia', async () => {
    await logDeletions('customer', [], 'user-1')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('nao lanca quando o insert falha (best-effort)', async () => {
    mockFrom.mockReturnValue({ insert: () => Promise.resolve({ error: new Error('db down') }) })
    await expect(logDeletions('container', [5], 'user-1')).resolves.toBeUndefined()
  })
})
