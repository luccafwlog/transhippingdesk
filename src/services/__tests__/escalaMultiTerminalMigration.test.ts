import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/306_escala_multiplos_terminais.sql'),
  'utf8',
)
const legacyAdrSchema = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/213_agency_departure_reports.sql'),
  'utf8',
)

describe('contrato SQL da escala com múltiplos terminais', () => {
  it('persiste estado por terminal e frente por escala com FK de porto', () => {
    expect(sql).toMatch(/ALTER TABLE public\.voyage_export_schedules[\s\S]+ADD COLUMN IF NOT EXISTS has_empty BOOLEAN NOT NULL DEFAULT FALSE/i)
    expect(sql).toMatch(/INSERT INTO public\.voyage_export_schedules[\s\S]+has_granite[\s\S]+has_empty/i)
    expect(sql).toMatch(
      /ADD CONSTRAINT depots_tipo_port_check[\s\S]+CHECK \([\s\S]+terminal_portuario[\s\S]+NOT VALID/i,
    )
    expect(sql).toContain('Nao ha backfill automatico.')
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.voyage_escala_terminal_state[\s\S]+terminal_atb TIMESTAMPTZ[\s\S]+terminal_atd TIMESTAMPTZ[\s\S]+terminal_rtw TIMESTAMPTZ[\s\S]+revision INTEGER[\s\S]+UNIQUE \(voyage_id, port, terminal_id\)/i,
    )
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.voyage_escala_operation_fronts[\s\S]+sentido TEXT[\s\S]+modalidade TEXT[\s\S]+terminal_id UUID[\s\S]+source TEXT[\s\S]+last_changed_by UUID/i,
    )
    expect(sql).toMatch(/FOREIGN KEY \(terminal_id, port_id\)[\s\S]+REFERENCES public\.depots\(id, port_id\) ON DELETE RESTRICT/i)
    expect(sql).not.toMatch(/terminal_id UUID(?: NOT NULL)? REFERENCES public\.depots\(id\)/i)
    expect(sql).toContain('A FK composta (terminal_id, port_id) é a única relação terminal->depot')
    expect(sql).toContain("source IN ('operational_data', 'export_declaration')")
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_voyage_escala_operation_front[\s\S]+\(voyage_id, port, sentido, modalidade\)/i)
    expect(sql).toContain('terminal_id UUID,')
  })

  it('persiste revision mesmo quando a escala não tem linhas filhas', () => {
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.voyage_escala_revision_state[\s\S]+voyage_id BIGINT[\s\S]+port TEXT[\s\S]+port_id BIGINT[\s\S]+revision INTEGER[\s\S]+PRIMARY KEY \(voyage_id, port\)/i,
    )
    expect(sql).toContain('port_id BIGINT NOT NULL REFERENCES public.ports(id) ON DELETE RESTRICT')
    expect(sql).toMatch(/SELECT rs\.revision[\s\S]+FROM public\.voyage_escala_revision_state[\s\S]+FOR UPDATE/i)
    expect(sql).toMatch(/UPDATE public\.voyage_escala_revision_state[\s\S]+revision = v_next_revision/i)
    expect(sql).toContain('voyage_escala_revision_state_select')
  })

  it('valida o payload inversamente e preserva ADR com dependentes', () => {
    expect(sql).toMatch(
      /FROM jsonb_to_recordset\(p_fronts\)[\s\S]+WHERE f\.terminal_id IS NOT NULL[\s\S]+FROM jsonb_to_recordset\(p_terminals\)[\s\S]+t\.terminal_id = f\.terminal_id/i,
    )
    expect(sql).toContain('Frente atribuida exige terminal no estado da escala.')
    expect(sql).toMatch(/agency_departure_report_signoffs[\s\S]+agency_departure_report_department_signoffs[\s\S]+agency_departure_report_occurrences/i)
    expect(sql).toContain('FROM public.alerts AS a')
    expect(sql).toContain("a.entity_type = 'agency_departure_report'")
    expect(sql).toContain("a.entity_id LIKE v_entity_id || '::%'")
    expect(sql).toContain('adr_preserved')
    expect(sql).toContain('Qualquer alerta do ADR')
    expect(sql).toMatch(/DELETE FROM public\.agency_departure_reports[\s\S]+status = 'open'/i)
  })

  it('audita expectativa inicial e expõe guarda de fechamento por report_id', () => {
    expect(sql).toMatch(/v_export_old IS DISTINCT FROM v_export_new[\s\S]+INSERT INTO public\.audit_logs/i)
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.assert_voyage_escala_ready_for_report_close\(\s*p_voyage_id BIGINT,\s*p_port TEXT,\s*p_report_id UUID\s*\)/i,
    )
    expect(sql).toContain('SECURITY DEFINER')
    expect(sql).toContain('Frente TBC impede o fechamento do ADR.')
    expect(sql).toContain('terminal_port_id')
    expect(sql).toContain('somente uma precondition de close')
    expect(sql).toContain('Nao deve ser chamada por reopen/signoff')
    expect(sql).toContain('ramos explicitos para legado, reopen e signoff')
    const closeGuardStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.assert_voyage_escala_ready_for_report_close')
    const closeGuardLock = sql.indexOf('PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;', closeGuardStart)
    const closeGuardReportSelect = sql.indexOf('SELECT r.id, r.voyage_id', closeGuardStart)
    expect(closeGuardStart).toBeGreaterThanOrEqual(0)
    expect(closeGuardLock).toBeGreaterThan(closeGuardStart)
    expect(closeGuardReportSelect).toBeGreaterThan(closeGuardLock)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.assert_voyage_escala_ready_for_report_close\(BIGINT, TEXT, UUID\)[\s\S]+FROM PUBLIC, anon/i)
  })

  it('retorna bloqueio estável sem escrever e trava ADR antes da remoção', () => {
    expect(sql).toMatch(
      /jsonb_agg\(\s*blocker[\s\S]+ORDER BY blocker->>'terminal_code', blocker->>'reason', blocker->>'report_id'[\s\S]+FROM jsonb_array_elements\(v_closed_blockers\) AS blockers\(blocker\)/i,
    )
    expect(sql).toMatch(
      /IF jsonb_array_length\(v_closed_blockers\) > 0 THEN[\s\S]+RETURN jsonb_build_object\([\s\S]+'revision', v_current_revision[\s\S]+'fronts'[\s\S]+'terminals'[\s\S]+'closed_blockers', v_closed_blockers[\s\S]+'blocked', TRUE[\s\S]+END IF;[\s\S]+INSERT INTO public\.voyage_escala_revision_state/i,
    )
    expect(sql).not.toContain("RAISE EXCEPTION 'ADR fechado; reabra antes de alterar a escala.")
    expect(sql).toMatch(
      /FOR v_report IN[\s\S]+FROM public\.agency_departure_reports AS r[\s\S]+FOR UPDATE OF r[\s\S]+LOOP[\s\S]+IF v_report\.status = 'open'/i,
    )
    const normalReturnStart = sql.lastIndexOf('RETURN jsonb_build_object(')
    expect(sql.slice(normalReturnStart)).toContain("'closed_blockers', '[]'::JSONB")
    expect(sql.slice(normalReturnStart)).toContain("'blocked', FALSE")
  })

  it('expõe preflight read-only do mapeamento de terminais legados', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.preflight_depots_terminal_port_mapping\(\)[\s\S]+RETURNS JSONB[\s\S]+STABLE[\s\S]+SECURITY DEFINER[\s\S]+SET search_path = public, pg_temp[\s\S]+pending_count[\s\S]+codes/i,
    )
    expect(sql).toContain('Task 8 deve resolver ou marcar')
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.preflight_depots_terminal_port_mapping\(\)[\s\S]+GRANT EXECUTE ON FUNCTION public\.preflight_depots_terminal_port_mapping\(\) TO authenticated/i,
    )
    expect(sql).toContain('janela controlada')
  })

  it('adiciona terminalização de ADRs sem apagar o legado nem os filhos por report_id', () => {
    expect(sql).toMatch(/ALTER TABLE public\.agency_departure_reports[\s\S]+ADD COLUMN IF NOT EXISTS terminal_id UUID/i)
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS agency_departure_reports_voyage_id_port_key')
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS\s+uq_agency_departure_reports_terminal[\s\S]+WHERE terminal_id IS NOT NULL/i)
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS\s+uq_agency_departure_reports_legacy[\s\S]+WHERE terminal_id IS NULL/i)
    expect(sql).not.toMatch(/DROP TABLE\s+public\.agency_departure_report/i)
    expect(sql).not.toMatch(/TRUNCATE\s+public\.agency_departure_report/i)
    expect(sql).toMatch(/DELETE\s+FROM\s+public\.agency_departure_reports[\s\S]+status = 'open'/i)
    expect(legacyAdrSchema).toContain('report_id UUID NOT NULL REFERENCES public.agency_departure_reports(id) ON DELETE CASCADE')
    expect(sql).toContain('report_id')
  })

  it('expõe a RPC transacional com revisão, lock, validações, ADR e retorno estável', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.save_voyage_escala_terminal_state\(\s*p_voyage_id BIGINT,\s*p_port TEXT,\s*p_expected_revision INTEGER,\s*p_fronts JSONB,\s*p_terminals JSONB,\s*p_export_expectation JSONB,\s*p_justification TEXT\s*\)/i,
    )
    expect(sql).toContain('SECURITY DEFINER')
    expect(sql).toContain('SET search_path = public, pg_temp')
    expect(sql).toMatch(/FROM public\.voyages[\s\S]+FOR UPDATE/i)
    expect(sql).toContain('REVISAO_OBSOLETA')
    expect(sql).toContain('terminal_atd < terminal_atb')
    expect(sql).toContain('closed_blockers')
    expect(sql).toContain('status = \'closed\'')
    expect(sql).toContain('terminal_code')
    expect(sql).toContain('report_id')
    expect(sql).toContain("'revision'")
    expect(sql).toContain("'fronts'")
    expect(sql).toContain("'terminals'")
    expect(sql).toMatch(/INSERT INTO public\.agency_departure_reports[\s\S]+terminal_id/i)
    expect(sql).toContain('ON CONFLICT (voyage_id, port, terminal_id) WHERE terminal_id IS NOT NULL')
    expect(sql).toContain("'front_created'")
    expect(sql).toContain("'front_removed'")
    expect(sql).toContain("'terminal_assignment'")
    expect(sql).toContain("'terminal_dates'")
    expect(sql).toContain("'export_expectation'")
    expect(sql).toContain("'voyage_pod_schedule'")
    expect(sql).toContain('actor_role')
    expect(sql).toContain('actor_department')
    expect(sql).toContain('p_justification')
  })

  it('mantém escrita somente pela RPC e revoga a superfície pública', () => {
    expect(sql).toMatch(/ALTER TABLE public\.voyage_escala_terminal_state ENABLE ROW LEVEL SECURITY/i)
    expect(sql).toMatch(/CREATE POLICY voyage_escala_terminal_state_select[\s\S]+FOR SELECT TO authenticated[\s\S]+is_active_read_user/i)
    expect(sql).toMatch(/ALTER TABLE public\.voyage_escala_operation_fronts ENABLE ROW LEVEL SECURITY/i)
    expect(sql).toMatch(/ALTER TABLE public\.voyage_escala_revision_state ENABLE ROW LEVEL SECURITY/i)
    expect(sql).toMatch(/CREATE POLICY voyage_escala_operation_fronts_select[\s\S]+FOR SELECT TO authenticated[\s\S]+is_active_read_user/i)
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.voyage_escala_terminal_state FROM PUBLIC, anon, authenticated/i)
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.voyage_escala_operation_fronts FROM PUBLIC, anon, authenticated/i)
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.voyage_escala_revision_state FROM PUBLIC, anon, authenticated/i)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.normalize_depot_code\(\) FROM PUBLIC, anon, authenticated/i)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.validate_escala_port_reference\(\) FROM PUBLIC, anon, authenticated/i)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.validate_agency_departure_report_port\(\) FROM PUBLIC, anon, authenticated/i)
    expect(sql).toMatch(/GRANT SELECT ON TABLE public\.voyage_escala_terminal_state TO authenticated/i)
    expect(sql).toMatch(/GRANT SELECT ON TABLE public\.voyage_escala_operation_fronts TO authenticated/i)
    expect(sql).toMatch(/GRANT SELECT ON TABLE public\.voyage_escala_revision_state TO authenticated/i)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.save_voyage_escala_terminal_state\(BIGINT, TEXT, INTEGER, JSONB, JSONB, JSONB, TEXT\) FROM PUBLIC, anon/i)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.save_voyage_escala_terminal_state\(BIGINT, TEXT, INTEGER, JSONB, JSONB, JSONB, TEXT\) TO authenticated/i)
  })
})
