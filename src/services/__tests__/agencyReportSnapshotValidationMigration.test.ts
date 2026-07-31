import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/249_agency_report_snapshot_validation.sql'),
  'utf-8',
)

describe('migration 249 — revalidação do snapshot no fechamento do ADR', () => {
  it('exige as quatro coleções canônicas e limita o payload a 1 MiB', () => {
    expect(sql).toMatch(/jsonb_typeof\(p_snapshot->'header'\) <> 'object'/)
    expect(sql).toMatch(/jsonb_typeof\(p_snapshot->'sections'\) <> 'object'/)
    expect(sql).toMatch(/jsonb_typeof\(p_snapshot->'occurrences'\) <> 'array'/)
    expect(sql).toMatch(/jsonb_typeof\(p_snapshot->'signoffs'\) <> 'array'/)
    expect(sql).toContain('octet_length(p_snapshot::text) > 1048576')
  })

  it('allowlist de chaves de topo inclui departmentSignoffs (Task 5)', () => {
    expect(sql).toContain("key NOT IN ('header', 'sections', 'occurrences', 'signoffs', 'departmentSignoffs')")
  })

  it('allowlist de seções reflete o que a aba envia hoje', () => {
    expect(sql).toContain("'cargaDescarregada', 'cargaSolta', 'vaziosDescarregados', 'veiculos',")
    expect(sql).toContain("'vaziosEmbarcados', 'vaziosUnidades', 'vehicleLocations', 'depots',")
    expect(sql).toContain("'directEmbarkCount', 'granito', 'storage', 'operation', 'costs'")
    expect(sql).not.toContain('overtimeHandlingCount')
    expect(sql).not.toContain('overtimeTransportCount')
  })

  it('rejeita chaves de topo e seções fora do contrato', () => {
    expect(sql).toContain('Snapshot possui chaves de topo desconhecidas')
    expect(sql).toContain('Snapshot possui secoes desconhecidas')
  })

  it('preserva o gate de 3/3 departamentos da migration 224', () => {
    expect(sql).toContain('agency_departure_report_department_signoffs')
    expect(sql).toMatch(/v_signed_departments <> 3/)
    expect(sql).toContain('Fechamento exige os 3 departamentos assinados')
  })

  it('preserva o encerramento dos alertas legados pre-0029', () => {
    expect(sql).toContain("type = 'agency_report_section_pending'")
    expect(sql).toContain('agency_report_department_pending')
  })

  it('preserva a trava de idempotência do fechamento', () => {
    expect(sql).toContain("status = 'closed', closed_at = now(), closed_by = auth.uid(), closed_snapshot = p_snapshot")
    expect(sql).toContain('ADR ja fechado')
    expect(sql).toContain('FOR UPDATE')
  })
})
