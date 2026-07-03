import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Contrato estático da migration 165 (#320). O replay funcional real é validado
// no Postgres descartável (scripts/setup-local-pg.sh); aqui garantimos o SQL.
const sql = fs.readFileSync(
  path.resolve('supabase/migrations/165_manifest_overwrite_opt_in.sql'),
  'utf8',
)

describe('165 manifest overwrite opt-in migration', () => {
  it('adiciona p_apply_overwrites (default false) às duas RPCs', () => {
    expect(sql).toMatch(/import_manifest_transactional\([^)]*p_apply_overwrites boolean DEFAULT false/s)
    expect(sql).toMatch(/import_manifest_with_postprocess_transactional\([^)]*p_apply_overwrites boolean DEFAULT false/s)
  })

  it('torna os 7 campos comerciais condicionais (mantém o B/L por padrão)', () => {
    for (const f of ['shipper', 'consignee', 'cargo_description', 'pol', 'pod', 'total_weight_kg', 'total_cbm']) {
      expect(sql).toContain(`${f} = CASE WHEN p_apply_overwrites THEN EXCLUDED.${f} ELSE public.bls.${f} END`)
    }
  })

  it('audita FONTE_SOBRESCRITO apenas quando aplica', () => {
    expect(sql).toContain('FONTE_SOBRESCRITO')
    expect(sql).toMatch(/IF p_apply_overwrites AND v_existing_bl_ids IS NOT NULL/)
  })

  it('preserva o gate de privilégio (revoke PUBLIC/anon, grant authenticated)', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.import_manifest_transactional\([^)]*boolean\) FROM PUBLIC, anon/s)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.import_manifest_with_postprocess_transactional\([^)]*boolean\) TO authenticated/s)
  })
})
