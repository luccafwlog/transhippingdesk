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
const agencyPendingMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/251_agency_report_pending_escala_unificada.sql',
)

function functionBody(sql: string, name: string) {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]*?\\$function\\$;`, 'i')
  return sql.match(re)?.[0] ?? ''
}

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
    expect(sql).toContain('COUNT(DISTINCT normalized_pol)')
    expect(sql).toContain('granite_port_count')
    expect(sql).toContain('vazios_port_count')
    expect(sql).toContain('Fontes Granite/Vazios com mais de um POL brasileiro')
    expect(sql).toContain('snapshot de viagem')
    expect(sql).toContain('mais de um POL brasileiro')
    expect(sql).toContain('current_br_pol_count')
    expect(sql).toContain('THEN NULL')
  })

  it('switches uniqueness to voyage plus port and only tightens NOT NULL when no residue remains', () => {
    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toMatch(/unique\s*\(\s*voyage_id\s*,\s*pol\s*\)/i)
    expect(sql).toContain('WHERE pol IS NULL')
    expect(sql).not.toContain('ALTER COLUMN pol SET NOT NULL')
    expect(sql).toContain('RAISE NOTICE')
    expect(sql.toLowerCase()).toContain('manual')
  })
})

describe('251_agency_report_pending_escala_unificada.sql', () => {
  it('redefines detect_agency_report_pending from POD and POL ATD sources only for Brazilian ports', () => {
    const sql = readFileSync(agencyPendingMigrationPath, 'utf8')
    const body = functionBody(sql, 'detect_agency_report_pending')

    expect(body).not.toBe('')
    expect(body).toContain("entity_type IN ('voyage_pod_schedule', 'voyage_pol_schedule')")
    expect(body).toMatch(/DISTINCT ON \(entity_type, entity_id\)/)
    expect(body).toMatch(/upper\(trim\(split_part\(entity_id, '::', 2\)\)\) LIKE 'BR%'/)
  })

  it('keeps the 214 POD baseline and captures the POL baseline at migration execution time', () => {
    const sql = readFileSync(agencyPendingMigrationPath, 'utf8')
    const body = functionBody(sql, 'detect_agency_report_pending')

    expect(body).toContain("entity_type = 'voyage_pod_schedule'")
    expect(body).toContain("changed_at >= TIMESTAMPTZ '2026-07-19 00:00:00+00'")
    expect(body).toContain("entity_type = 'voyage_pol_schedule'")
    expect(body).toMatch(
      /changed_at >= \(\s*SELECT captured_at\s+FROM public\.agency_report_pending_baselines\s+WHERE baseline_key = 'voyage_pol_schedule_atd'\s*\)/i,
    )
    expect(sql).toMatch(
      /CREATE TABLE public\.agency_report_pending_baselines[\s\S]*baseline_key text PRIMARY KEY[\s\S]*captured_at timestamptz NOT NULL/i,
    )
    expect(sql).toMatch(
      /INSERT INTO public\.agency_report_pending_baselines\s*\(baseline_key, captured_at\)\s*VALUES\s*\('voyage_pol_schedule_atd',\s*clock_timestamp\(\)\)/i,
    )
    expect(sql).toContain(
      'REVOKE ALL ON TABLE public.agency_report_pending_baselines FROM PUBLIC, anon, authenticated;',
    )
    expect(sql).not.toContain("2026-08-03 00:00:00+00")
  })

  it('preserves department-level grouping, sign-off closure contract, and RPC security', () => {
    const sql = readFileSync(agencyPendingMigrationPath, 'utf8')
    const body = functionBody(sql, 'detect_agency_report_pending')

    expect(body).toMatch(/SELECT unnest\(ARRAY\['operacoes', 'documentacao', 'equipamentos'\]\) AS department/)
    expect(body).toContain("'agency_report_department_pending'")
    expect(body).not.toMatch(/CREATE OR REPLACE FUNCTION public\.set_agency_report_department_signoff/)
    expect(body).not.toMatch(/CREATE OR REPLACE FUNCTION public\.close_agency_departure_report/)
    expect(sql).toContain('SECURITY DEFINER')
    expect(sql).toContain('SET search_path = public, pg_temp')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.detect_agency_report_pending() FROM PUBLIC, anon;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.detect_agency_report_pending() TO authenticated;')
  })

  it('documents intent, affected function, alerts consumer, and rollback in the migration header', () => {
    const sql = readFileSync(agencyPendingMigrationPath, 'utf8')
    const header = sql.split('CREATE OR REPLACE FUNCTION public.detect_agency_report_pending()')[0]

    expect(header).toContain('Intent:')
    expect(header).toContain('Afetadas: detect_agency_report_pending')
    expect(header).toContain('Consumidores: src/services/alerts.ts')
    expect(header).toContain('Rollback:')
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
      temExportacao: true,
                has_granite: true,
                containers_qty: 4,
                movements_qty: 5,
                ce_status: 'approved',
                linked: false,
              },
              {
                id: 'exp-1',
                voyage_id: 7,
                pol: 'salvador',
      temExportacao: true,
                has_granite: false,
                containers_qty: 10,
                movements_qty: 12,
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
      temExportacao: true,
      hasGranite: true,
      containersQty: 3,
      movementsQty: 8,
      ceStatus: 'approved',
      linked: true,
    })

    expect(upsert).toHaveBeenCalledTimes(1)
    const [, options] = upsert.mock.calls[0] as unknown as [unknown, { onConflict: string }]
    expect(options).toMatchObject({ onConflict: 'voyage_id,pol' })
  })

  // A migration 252 tornou pol NOT NULL: exportação sem porto não é escala.
  it('refuses to persist an export schedule without a port', async () => {
    const eq = vi.fn(async () => ({ error: null }))
    const update = vi.fn(() => ({ eq }))
    const upsert = vi.fn(async () => ({ error: null }))
    from.mockImplementation(() => ({ update, upsert }))

    const { saveVoyageExportSchedule } = await import('../voyageExportSchedules')
    await expect(
      saveVoyageExportSchedule({
        existingId: 'row-sem-porto',
        voyageId: 19,
        pol: null,
        temExportacao: true,
        hasGranite: false,
        containersQty: 1,
        movementsQty: 2,
        ceStatus: 'waiting',
        linked: false,
      }),
    ).rejects.toThrow(/porto da escala/i)

    expect(update).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })
})
