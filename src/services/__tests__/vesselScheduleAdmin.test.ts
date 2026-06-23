import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { archiveVesselSchedule, reorderVesselSchedules } from '../vesselScheduleAdmin'

const { mockRpc } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    rpc: mockRpc,
  },
}))

describe('vessel schedule admin operations', () => {
  beforeEach(() => {
    mockRpc.mockReset()
  })

  it('archives one active vessel through a single transactional RPC', async () => {
    mockRpc.mockResolvedValue({ data: { archived_id: 'ended-1' }, error: null })

    await archiveVesselSchedule('vessel-1')

    expect(mockRpc).toHaveBeenCalledWith('archive_vessel_schedule', {
      p_vessel_id: 'vessel-1',
    })
  })

  it('persists the complete order through one transactional RPC', async () => {
    mockRpc.mockResolvedValue({ data: 2, error: null })

    await reorderVesselSchedules([
      { id: 'vessel-2', displayOrder: 0 },
      { id: 'vessel-1', displayOrder: 1 },
    ])

    expect(mockRpc).toHaveBeenCalledWith('reorder_vessel_schedules', {
      p_order: [
        { id: 'vessel-2', display_order: 0 },
        { id: 'vessel-1', display_order: 1 },
      ],
    })
  })

  it('has SQL contracts that archive and reorder atomically with restricted execution', () => {
    const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations')
    const migration = fs.readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
      .find((sql) =>
        sql.includes('archive_vessel_schedule') &&
        sql.includes('reorder_vessel_schedules'),
      )

    expect(migration).toBeDefined()
    expect(migration).toMatch(/INSERT\s+INTO\s+public\.ended_vessels/i)
    expect(migration).toMatch(/DELETE\s+FROM\s+public\.vessel_schedules/i)
    expect(migration).toMatch(/UPDATE\s+public\.vessel_schedules/i)
    expect(migration).toMatch(/FOR\s+UPDATE/i)
    expect(migration).toMatch(/SECURITY\s+INVOKER/i)
    expect(migration).toMatch(/REVOKE\s+ALL[\s\S]*FROM\s+PUBLIC,\s*anon/i)
    expect(migration).toMatch(/GRANT\s+EXECUTE[\s\S]*TO\s+authenticated/i)
  })

  it('grants table privileges required by the vessel schedule RLS policies', () => {
    const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations')
    const sql = fs.readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
      .join('\n')

    expect(sql).toMatch(/ON TABLE public\.vessel_schedules[\s\S]*TO authenticated/i)
    expect(sql).toMatch(/ON TABLE public\.ended_vessels[\s\S]*TO authenticated/i)
  })
})
