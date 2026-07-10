import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock, updateMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  updateMock: vi.fn(),
}))

vi.mock('../supabase', () => ({ supabase: { from: fromMock } }))

import { deriveAutomaticVoyagePodCeStatus, saveVoyagePodSchedule } from '../voyageRouteSchedules'

beforeEach(() => {
  fromMock.mockReset()
  updateMock.mockReset()
})

describe('deriveAutomaticVoyagePodCeStatus', () => {
  it('deriva o status automatico sem promover para aprovado', () => {
    expect(deriveAutomaticVoyagePodCeStatus(0, 3)).toBe('missing')
    expect(deriveAutomaticVoyagePodCeStatus(1, 3)).toBe('launching')
    expect(deriveAutomaticVoyagePodCeStatus(3, 3)).toBe('approving')
  })

  it('nao deriva status quando nao ha B/Ls na rota', () => {
    expect(deriveAutomaticVoyagePodCeStatus(0, 0)).toBeNull()
  })
})

it('nao reverte uma viagem cancelada quando o ATD muda', async () => {
  let auditSelects = 0
  const auditLogs = {
    select: vi.fn(() => {
      auditSelects += 1
      if (auditSelects === 1) {
        return {
          eq: vi.fn(() => ({
            in: vi.fn(() => ({ order: vi.fn(() => ({ range: vi.fn(async () => ({ data: [], error: null })) })) })),
          })),
        }
      }
      return {
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            range: vi.fn(async () => ({
              data: [{ entity_id: '12::BRSSZ', field_name: 'atd', new_value: null, changed_at: null }],
              error: null,
            })),
          })),
        })),
      }
    }),
    insert: vi.fn(async () => ({ error: null })),
  }
  const voyages = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: { status: 'cancelled' }, error: null })) })),
    })),
    update: updateMock.mockReturnValue({ eq: vi.fn(async () => ({ error: null })) }),
  }

  fromMock.mockImplementation((table: string) => (table === 'audit_logs' ? auditLogs : voyages))

  await saveVoyagePodSchedule({
    voyageId: 12,
    pod: 'BRSSZ',
    eta: null,
    etb: null,
    ata: null,
    atd: '2026-07-10',
    rtw: null,
    ceStatus: null,
    linked: null,
    changedBy: 'user-1',
  })

  expect(updateMock).not.toHaveBeenCalled()
})
