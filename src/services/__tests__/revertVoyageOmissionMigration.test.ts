import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations')
const migration309 = fs.readFileSync(path.join(migrationsDir, '309_revert_voyage_omission.sql'), 'utf8')
const migration306 = fs.readFileSync(path.join(migrationsDir, '306_escala_multiplos_terminais.sql'), 'utf8')
const migration308 = fs.readFileSync(path.join(migrationsDir, '308_restore_omit_voyage_escala.sql'), 'utf8')

function functionBody(source: string, functionName: string) {
  const match = source.match(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${functionName}\\([\\s\\S]*?\\$function\\$([\\s\\S]*?)\\$function\\$;`, 'i'))
  expect(match, `função ${functionName} não encontrada`).toBeTruthy()
  return match?.[1] ?? ''
}

describe('contrato da reversão de omissão de escala', () => {
  it('define uma RPC Admin-only que bloqueia COD e reverte tudo atomicamente', () => {
    const body = functionBody(migration309, 'revert_voyage_omission')

    expect(migration309).toMatch(/CREATE OR REPLACE FUNCTION public\.revert_voyage_omission\(\s*p_omission_id BIGINT,\s*p_justification TEXT,\s*p_changed_by UUID/i)
    expect(migration309).toMatch(/CREATE OR REPLACE FUNCTION public\.revert_voyage_omission\([\s\S]*?\) RETURNS VOID\s*LANGUAGE plpgsql\s*SECURITY DEFINER/i)
    expect(body).toMatch(/public\.is_admin\(\)/i)
    expect(body).toMatch(/p_changed_by IS DISTINCT FROM auth\.uid\(\)/i)
    expect(body).toMatch(/NULLIF\(btrim\(COALESCE\(p_justification, ''\)\), ''\)/i)
    expect(body).toMatch(/SELECT COUNT\(\*\).*disposition\s*=\s*'cod'/is)
    expect(body).toMatch(/v_cod_count.*RAISE EXCEPTION/is)
    expect(body).toMatch(/v_cod_count.*B\/L/is)
    expect(body).toMatch(/'voyage_pod_schedule'.*'omitted'.*'true'.*'false'/is)
    expect(body).toMatch(/INSERT INTO public\.portal_notifications\s*\(customer_id, bl_id, type, title, message, link\)/i)
    expect(body).toMatch(/Corre[cç][aã]o.*omiss[aã]o|omiss[aã]o.*revertida/is)
    expect(body).toMatch(/DELETE FROM public\.bl_transshipments/i)
    expect(body).toMatch(/DELETE FROM public\.voyage_omissions/i)
    expect(body).not.toMatch(/UPDATE public\.(voyage_escala_terminal_state|voyage_escala_operation_fronts|agency_departure_reports)/i)
    expect(body).not.toMatch(/DELETE FROM public\.(voyage_escala_terminal_state|voyage_escala_operation_fronts|agency_departure_reports)/i)

    expect(migration309).toMatch(/REVOKE ALL ON FUNCTION public\.revert_voyage_omission\(BIGINT, TEXT, UUID\) FROM PUBLIC, anon/i)
    expect(migration309).toMatch(/GRANT EXECUTE ON FUNCTION public\.revert_voyage_omission\(BIGINT, TEXT, UUID\) TO authenticated/i)
  })

  it('torna a segunda omissão um conflito explícito e preserva o guard catalogado da 308', () => {
    const omitBody = functionBody(migration309, 'omit_voyage_escala')

    expect(omitBody).toMatch(/IF EXISTS[\s\S]*voyage_omissions[\s\S]*omitted_pod[\s\S]*RAISE EXCEPTION/i)
    expect(omitBody).not.toMatch(/ON CONFLICT\s*\(voyage_id, omitted_pod\)\s*DO UPDATE/i)
    expect(migration308).toMatch(/pg_constraint/i)
    expect(migration308).toMatch(/regexp_replace\(lower\(pg_get_constraintdef/i)
    expect(migration308).toMatch(/DROP CONSTRAINT %I/i)
  })

  it('mantém a escala revertida ativa nos dois consumidores do audit omitted', () => {
    const saveBody = functionBody(migration306, 'save_voyage_escala_terminal_state')
    const deadlineBody = functionBody(migration306, 'detect_agency_report_deadline_missed')

    expect(saveBody).toMatch(/latest_omitted[\s\S]*?COALESCE\(o\.new_value, 'false'\) <> 'true'/i)
    expect(deadlineBody).toMatch(/latest_omitted[\s\S]*?o\.new_value = 'true'[\s\S]*?NOT omitted/i)
  })
})
