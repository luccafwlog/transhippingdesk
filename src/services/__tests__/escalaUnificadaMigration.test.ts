import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()

vi.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => from(table),
  },
}))

const migrationPath = resolve(process.cwd(), 'supabase/migrations/250_voyage_export_schedules_por_escala.sql')

describe('250_voyage_export_schedules_por_escala.sql', () => {
  it('uses the current voyage POL snapshot first, preserves precedence, and normalizes the chosen source to LOCODE', () => {
    const sql = readFileSync(migrationPath, 'utf8')

    const polScheduleIndex = sql.indexOf('pol_schedule_snapshot')
    const graniteIndex = sql.indexOf('granite_manifests')
    const vaziosIndex = sql.indexOf('vazios_export_operations')

    expect(polScheduleIndex).toBeGreaterThanOrEqual(0)
    expect(graniteIndex).toBeGreaterThan(polScheduleIndex)
    expect(vaziosIndex).toBeGreaterThan(graniteIndex)
    expect(sql).toContain('jsonb_each')
    expect(sql).toContain('public.normalize_port_code')
  })

  it('guards against the old arbitrary history MAX and documents the current-state compatibility choice', () => {
    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).not.toContain("FROM public.audit_logs al")
    expect(sql).not.toContain('MAX(source.normalized_pol)')
    expect(sql).toContain('snapshot de viagem')
    expect(sql).toContain('mais de um POL brasileiro')
    expect(sql).toContain('current_br_pol_count')
    expect(sql).toContain('THEN NULL')
  })

  it('switches uniqueness to voyage plus port and only tightens NOT NULL when no residue remains', () => {
    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toMatch(/unique\s*\(\s*voyage_id\s*,\s*pol\s*\)/i)
    expect(sql).toContain('IF v_remaining_null_pol_count = 0 THEN')
    expect(sql).toContain('ALTER COLUMN pol SET NOT NULL')
    expect(sql).toContain('RAISE NOTICE')
    expect(sql.toLowerCase()).toContain('manual')
  })
})

describe('voyageExportSchedules service', () => {
  beforeEach(() => {
    from.mockReset()
  })

  it('groups multiple export rows from the same voyage by POL in deterministic normalized-port order', async () => {
    from.mockImplementation((table: string) => {
      expect(table).toBe('voyage_export_schedules')
      return {
        select: vi.fn(() => ({
          in: vi.fn(async () => ({
            data: [
              {
                id: 'exp-2',
                voyage_id: 7,
                pol: 'BRVIX',
                has_granite: true,
                containers_qty: 4,
                movements_qty: 5,
                eta: '2026-08-03',
                etb: '2026-08-04',
                ce_status: 'approved',
                linked: false,
              },
              {
                id: 'exp-1',
                voyage_id: 7,
                pol: 'salvador',
                has_granite: false,
                containers_qty: 10,
                movements_qty: 12,
                eta: '2026-08-01',
                etb: '2026-08-02',
                ce_status: 'waiting',
                linked: true,
              },
            ],
            error: null,
          })),
        })),
      }
    })

    const { fetchExportSchedulesByVoyageIds } = await import('../voyageExportSchedules')
    const schedules = await fetchExportSchedulesByVoyageIds([7])
    const byPort = schedules.get(7) as unknown as Map<string, { id: string; linked: boolean }>

    expect(byPort).toBeInstanceOf(Map)
    expect(Array.from(byPort.keys())).toEqual(['BRSSA', 'BRVIX'])
    expect(byPort.get('BRSSA')).toMatchObject({ id: 'exp-1', linked: true })
    expect(byPort.get('BRVIX')).toMatchObject({ id: 'exp-2', linked: false })
  })

  it('upserts export planning by voyage and POL', async () => {
    const upsert = vi.fn(async () => ({ error: null }))
    from.mockImplementation((table: string) => {
      expect(table).toBe('voyage_export_schedules')
      return { upsert }
    })

    const { saveVoyageExportSchedule } = await import('../voyageExportSchedules')
    await saveVoyageExportSchedule({
      voyageId: 11,
      pol: 'BRSSA',
      hasGranite: true,
      containersQty: 3,
      movementsQty: 8,
      eta: '2026-08-10',
      etb: '2026-08-11',
      ceStatus: 'approved',
      linked: true,
    })

    expect(upsert).toHaveBeenCalledTimes(1)
    const [, options] = upsert.mock.calls[0] as unknown as [unknown, { onConflict: string }]
    expect(options).toMatchObject({ onConflict: 'voyage_id,pol' })
  })

  it('updates the existing row by id when editing a legacy null-POL schedule', async () => {
    const eq = vi.fn(async () => ({ error: null }))
    const update = vi.fn(() => ({ eq }))
    const upsert = vi.fn(async () => ({ error: null }))
    from.mockImplementation((table: string) => {
      expect(table).toBe('voyage_export_schedules')
      return { update, upsert }
    })

    const { saveVoyageExportSchedule } = await import('../voyageExportSchedules')
    await saveVoyageExportSchedule({
      existingId: 'legacy-null-pol-row',
      previousPol: null,
      voyageId: 19,
      pol: null,
      hasGranite: false,
      containersQty: 1,
      movementsQty: 2,
      eta: '2026-08-15',
      etb: '2026-08-16',
      ceStatus: 'waiting',
      linked: false,
    })

    expect(update).toHaveBeenCalledTimes(1)
    expect(eq).toHaveBeenCalledWith('id', 'legacy-null-pol-row')
    expect(upsert).not.toHaveBeenCalled()
  })
})
