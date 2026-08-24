import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/341_atracacao_datas_por_terminal.sql'), 'utf8')
const alertsSql = readFileSync(resolve(process.cwd(), 'supabase/migrations/342_atracacao_alertas.sql'), 'utf8')

describe('contratos SQL de Atracação', () => {
  it('não faz a migration histórica 338 depender das colunas futuras de Atracação', () => {
    const legacyAlertsSql = readFileSync(resolve(process.cwd(), 'supabase/migrations/338_alerts_review_hardening.sql'), 'utf8')

    expect(legacyAlertsSql).not.toMatch(/terminal_etb|terminal_etd/i)
  })

  it('mantem os prefixos numericos de migration unicos', () => {
    const migrationNames = readdirSync(resolve(process.cwd(), 'supabase/migrations'))
      .filter((name) => /^\d+_.*\.sql$/.test(name))
    const prefixes = migrationNames.map((name) => name.match(/^(\d+)_/)?.[1]).filter(Boolean)
    const duplicatedPrefixes = prefixes.filter((prefix, index) => prefixes.indexOf(prefix) !== index)

    expect(duplicatedPrefixes).toEqual([])
  })

  it('adiciona datas previstas, TBC único e checks de ordem', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS terminal_etb TIMESTAMPTZ/i)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS terminal_etd TIMESTAMPTZ/i)
    expect(sql).toMatch(/ALTER COLUMN terminal_id DROP NOT NULL/i)
    expect(sql).toMatch(/uq_voyage_escala_terminal_state_tbc[\s\S]+WHERE terminal_id IS NULL/i)
    expect(sql).toMatch(/terminal_atd >= terminal_atb/i)
    expect(sql).toMatch(/terminal_etd >= terminal_etb/i)
  })

  it('faz a escrita nova por uma RPC única e cobre alertas por terminal', () => {
    expect(sql).toMatch(/save_voyage_escala_terminal_state_v2/i)
    expect(alertsSql).toMatch(/terminal_etb IS NOT NULL/i)
    expect(alertsSql).toMatch(/terminal_atb IS NOT NULL AND v_term_rec\.terminal_etd IS NULL/i)
    expect(alertsSql).toMatch(/terminal_etd IS NOT NULL[\s\S]+terminal_atd IS NULL/i)
    expect(alertsSql).toMatch(/terminal_id IS NOT NULL/i)
    expect(alertsSql).toMatch(/legacy_scale_berth_milestone_retired/i)
    expect(alertsSql).toMatch(/reconcile_agency_report_alerts\([\s\S]+terminal_atd/i)
    expect(alertsSql).toMatch(/detect_agency_report_deadline_missed\(\)[\s\S]+reconcile_agency_report_alerts/i)
  })
})
