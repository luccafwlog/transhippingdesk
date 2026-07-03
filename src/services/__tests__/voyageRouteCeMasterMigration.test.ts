import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Contrato estático da migration 167 (#322). Replay funcional validado no
// Postgres descartável (scripts/setup-local-pg.sh): "CE Master por rota OK".
const sql = fs.readFileSync(
  path.resolve('supabase/migrations/167_voyage_route_ce_master.sql'),
  'utf8',
)

describe('167 voyage_route_ce_master migration', () => {
  it('cria a tabela com unicidade por rota (voyage/pol/pod)', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.voyage_route_ce_master')
    expect(sql).toContain('UNIQUE (voyage_id, pol, pod)')
  })

  it('habilita RLS e restringe a authenticated', () => {
    expect(sql).toContain('ALTER TABLE public.voyage_route_ce_master ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.set_voyage_route_ce_master')
    expect(sql).toContain('TO authenticated')
  })

  it('a RPC exige usuario ativo e dono do changed_by (gate de auditoria)', () => {
    expect(sql).toContain('SECURITY DEFINER')
    expect(sql).toContain('auth.uid() IS NULL OR NOT public.is_active_user()')
    expect(sql).toContain('p_changed_by IS DISTINCT FROM auth.uid()')
  })

  it('faz upsert por rota e audita a troca de CE Master', () => {
    expect(sql).toContain('ON CONFLICT (voyage_id, pol, pod)')
    expect(sql).toContain("INSERT INTO public.audit_logs")
    expect(sql).toContain("'ce_master'")
  })
})
