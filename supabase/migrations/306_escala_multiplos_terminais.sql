-- 306: escala com múltiplos terminais, frentes e ADRs terminalizados.
-- Intent: acrescentar o vínculo terminal-portuário ao Cadastro de Terminais,
-- persistir a alocação por frente e manter ADRs legados sem terminal.
-- Affected objects: depots, audit_logs, voyage_export_schedules,
-- voyage_escala_terminal_state, voyage_escala_operation_fronts e
-- voyage_escala_revision_state e agency_departure_reports.
-- Consumers: RPC save_voyage_escala_terminal_state e as superfícies futuras da
-- escala, ADR, Line-Up, Painel e TV.
-- Rollback: em ambiente descartável, remover a RPC, os índices/policies e as
-- tabelas novas; para reversão operacional, não remover terminais ou ADRs e
-- reverter a aplicação para leitura das chaves legadas.
-- Operacao: os UPDATE/ALTER e a criacao de indices desta migration exigem
-- janela controlada, com acompanhamento de locks e impacto operacional.

-- A declaração de vazios é uma decisão explícita da escala. Quantidades são
-- dados de operação e não podem criar ou remover a frente de exportação.
ALTER TABLE public.voyage_export_schedules
  ADD COLUMN IF NOT EXISTS has_empty BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.voyage_export_schedules.has_empty IS
  'Declaração explícita de embarque de vazios na escala; independente das quantidades realizadas.';

-- Compatibilidade com o legado: antes de has_empty, a única pista persistida
-- de vazios era a quantidade operacional. Isso recupera somente essa
-- declaração antiga; novas alterações continuam exigindo a decisão explícita.
UPDATE public.voyage_export_schedules
SET has_empty = TRUE
WHERE has_empty = FALSE
  AND tem_exportacao = TRUE
  AND (COALESCE(containers_qty, 0) > 0 OR COALESCE(movements_qty, 0) > 0);

-- O código é normalizado no banco para que escrita direta do Cadastro não
-- reintroduza diferenças de caixa ou espaços.
ALTER TABLE public.depots
  ADD COLUMN IF NOT EXISTS port_id BIGINT REFERENCES public.ports(id) ON DELETE RESTRICT;

-- Preflight somente leitura: informa o legado que ainda precisa de mapeamento.
-- Nao faz backfill automatico. A Task 8 deve resolver ou marcar esses
-- terminais antes de validar plenamente a constraint NOT VALID.
CREATE OR REPLACE FUNCTION public.preflight_depots_terminal_port_mapping()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'pending_count', (
      SELECT count(*)
      FROM public.depots AS d
      WHERE d.tipo = 'terminal_portuario' AND d.port_id IS NULL
    ),
    'codes', COALESCE((
      SELECT jsonb_agg(d.code ORDER BY d.code)
      FROM public.depots AS d
      WHERE d.tipo = 'terminal_portuario' AND d.port_id IS NULL
    ), '[]'::JSONB)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.preflight_depots_terminal_port_mapping() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preflight_depots_terminal_port_mapping() TO authenticated;

ALTER TABLE public.depots
  DROP CONSTRAINT IF EXISTS depots_code_key;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.depots
    GROUP BY upper(btrim(code))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cadastro de Terminais possui códigos duplicados após normalização.'
      USING ERRCODE = '23505';
  END IF;
END $$;

UPDATE public.depots
SET code = upper(btrim(code))
WHERE code IS DISTINCT FROM upper(btrim(code));

CREATE UNIQUE INDEX IF NOT EXISTS depots_code_normalized_key
  ON public.depots (upper(btrim(code)));

ALTER TABLE public.depots
  DROP CONSTRAINT IF EXISTS depots_code_normalized_check,
  ADD CONSTRAINT depots_code_normalized_check
    CHECK (btrim(code) <> '' AND code = upper(btrim(code))),
  DROP CONSTRAINT IF EXISTS depots_tipo_port_check,
  -- A coluna é compatível com terminais legados sem mapeamento. A trigger
  -- abaixo impede novos terminais sem porto sem invalidar o legado existente;
  -- depois do preflight e do mapeamento, a constraint pode ser validada.
  ADD CONSTRAINT depots_tipo_port_check
    CHECK (
      (tipo = 'terminal_portuario')
      OR (tipo = 'depot' AND port_id IS NULL)
    ),
  DROP CONSTRAINT IF EXISTS depots_id_port_id_key,
  ADD CONSTRAINT depots_id_port_id_key UNIQUE (id, port_id);

CREATE INDEX IF NOT EXISTS idx_depots_port_id_active
  ON public.depots (port_id, active);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_id
  ON public.audit_logs (entity_id);

CREATE OR REPLACE FUNCTION public.normalize_depot_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  NEW.code := upper(btrim(NEW.code));
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS normalize_depot_code ON public.depots;
CREATE TRIGGER normalize_depot_code
  BEFORE INSERT OR UPDATE OF code ON public.depots
  FOR EACH ROW EXECUTE FUNCTION public.normalize_depot_code();

CREATE OR REPLACE FUNCTION public.validate_depot_terminal_port()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.tipo = 'depot' AND NEW.port_id IS NOT NULL THEN
    RAISE EXCEPTION 'Depot comum nao pode ter porto brasileiro.' USING ERRCODE = '23514';
  END IF;
  IF NEW.tipo = 'terminal_portuario'
     AND NEW.port_id IS NULL
     AND (TG_OP = 'INSERT' OR OLD.tipo <> 'terminal_portuario' OR OLD.port_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Novo terminal portuario exige porto brasileiro.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS validate_depot_terminal_port ON public.depots;
CREATE TRIGGER validate_depot_terminal_port
  BEFORE INSERT OR UPDATE OF tipo, port_id ON public.depots
  FOR EACH ROW EXECUTE FUNCTION public.validate_depot_terminal_port();

REVOKE ALL ON FUNCTION public.normalize_depot_code() FROM PUBLIC, anon, authenticated;

-- A FK composta (terminal_id, port_id) é a única relação terminal->depot nas
-- entidades novas; ela evita ambiguidade no PostgREST e impede depot comum ou
-- terminal portuário cadastrado em outro porto.
CREATE TABLE IF NOT EXISTS public.voyage_escala_terminal_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voyage_id BIGINT NOT NULL REFERENCES public.voyages(id) ON DELETE CASCADE,
  port TEXT NOT NULL CHECK (port = upper(btrim(port)) AND btrim(port) <> ''),
  port_id BIGINT NOT NULL REFERENCES public.ports(id) ON DELETE RESTRICT,
  terminal_id UUID NOT NULL,
  terminal_atb TIMESTAMPTZ,
  terminal_atd TIMESTAMPTZ,
  terminal_rtw INTEGER,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (voyage_id, port, terminal_id),
  FOREIGN KEY (terminal_id, port_id)
    REFERENCES public.depots(id, port_id) ON DELETE RESTRICT,
  CHECK (terminal_atd IS NULL OR (terminal_atb IS NOT NULL AND terminal_atd >= terminal_atb))
);

CREATE INDEX IF NOT EXISTS idx_voyage_escala_terminal_state_scale
  ON public.voyage_escala_terminal_state (voyage_id, port);
CREATE INDEX IF NOT EXISTS idx_voyage_escala_terminal_state_terminal
  ON public.voyage_escala_terminal_state (terminal_id);

CREATE TABLE IF NOT EXISTS public.voyage_escala_operation_fronts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voyage_id BIGINT NOT NULL REFERENCES public.voyages(id) ON DELETE CASCADE,
  port TEXT NOT NULL CHECK (port = upper(btrim(port)) AND btrim(port) <> ''),
  port_id BIGINT NOT NULL REFERENCES public.ports(id) ON DELETE RESTRICT,
  sentido TEXT NOT NULL,
  modalidade TEXT NOT NULL,
  terminal_id UUID,
  source TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CHECK (
    (sentido = 'importacao' AND modalidade IN ('carga_cheia', 'carga_solta', 'vazio', 'veiculo'))
    OR (sentido = 'exportacao' AND modalidade IN ('granito', 'vazio'))
  ),
  CHECK (source IN ('operational_data', 'export_declaration')),
  CHECK (
    (sentido = 'importacao' AND source = 'operational_data')
    OR (sentido = 'exportacao' AND source = 'export_declaration')
  ),
  FOREIGN KEY (terminal_id, port_id)
    REFERENCES public.depots(id, port_id) ON DELETE RESTRICT
);

-- ponytail: a frente inteira aponta para um terminal; se o shifting precisar
-- de granularidade documental, o upgrade é descer a atribuição para BL/unidade.
CREATE UNIQUE INDEX IF NOT EXISTS uq_voyage_escala_operation_front
  ON public.voyage_escala_operation_fronts (voyage_id, port, sentido, modalidade);
CREATE INDEX IF NOT EXISTS idx_voyage_escala_operation_fronts_terminal
  ON public.voyage_escala_operation_fronts (terminal_id);

-- A revisão pertence à escala, não às linhas opcionais de frente/terminal.
-- Assim, uma gravação válida de escala vazia também deixa um marcador
-- concorrencial durável para o próximo expected_revision.
CREATE TABLE IF NOT EXISTS public.voyage_escala_revision_state (
  voyage_id BIGINT NOT NULL REFERENCES public.voyages(id) ON DELETE CASCADE,
  port TEXT NOT NULL CHECK (port = upper(btrim(port)) AND btrim(port) <> ''),
  port_id BIGINT NOT NULL REFERENCES public.ports(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (voyage_id, port)
);

CREATE INDEX IF NOT EXISTS idx_voyage_escala_revision_state_port
  ON public.voyage_escala_revision_state (port_id);

CREATE OR REPLACE FUNCTION public.validate_escala_port_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.ports AS p
    WHERE p.id = NEW.port_id
      AND upper(btrim(p.locode)) = NEW.port
  ) THEN
    RAISE EXCEPTION 'Porto da escala não corresponde ao ports.id informado.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_agency_departure_report_port()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.ports AS p
    WHERE p.id = NEW.terminal_port_id
      AND upper(btrim(p.locode)) = NEW.port
  ) THEN
    RAISE EXCEPTION 'Porto do ADR não corresponde ao ports.id informado.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS validate_voyage_escala_terminal_port ON public.voyage_escala_terminal_state;
CREATE TRIGGER validate_voyage_escala_terminal_port
  BEFORE INSERT OR UPDATE ON public.voyage_escala_terminal_state
  FOR EACH ROW EXECUTE FUNCTION public.validate_escala_port_reference();

DROP TRIGGER IF EXISTS validate_voyage_escala_front_port ON public.voyage_escala_operation_fronts;
CREATE TRIGGER validate_voyage_escala_front_port
  BEFORE INSERT OR UPDATE ON public.voyage_escala_operation_fronts
  FOR EACH ROW EXECUTE FUNCTION public.validate_escala_port_reference();

DROP TRIGGER IF EXISTS validate_voyage_escala_revision_port ON public.voyage_escala_revision_state;
CREATE TRIGGER validate_voyage_escala_revision_port
  BEFORE INSERT OR UPDATE ON public.voyage_escala_revision_state
  FOR EACH ROW EXECUTE FUNCTION public.validate_escala_port_reference();

DROP TRIGGER IF EXISTS set_voyage_escala_terminal_state_updated_at ON public.voyage_escala_terminal_state;
CREATE TRIGGER set_voyage_escala_terminal_state_updated_at
  BEFORE UPDATE ON public.voyage_escala_terminal_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_voyage_escala_operation_fronts_updated_at ON public.voyage_escala_operation_fronts;
CREATE TRIGGER set_voyage_escala_operation_fronts_updated_at
  BEFORE UPDATE ON public.voyage_escala_operation_fronts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_voyage_escala_revision_state_updated_at ON public.voyage_escala_revision_state;
CREATE TRIGGER set_voyage_escala_revision_state_updated_at
  BEFORE UPDATE ON public.voyage_escala_revision_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- A coluna textual e os ADRs legados permanecem intactos. terminal_port_id é
-- nulo para legado e permite uma FK composta restrita ao porto nos novos ADRs.
-- Para ADRs terminalizados, essa FK composta é a única relação com depots.
ALTER TABLE public.agency_departure_reports
  ADD COLUMN IF NOT EXISTS terminal_id UUID,
  ADD COLUMN IF NOT EXISTS terminal_port_id BIGINT;

ALTER TABLE public.agency_departure_reports
  DROP CONSTRAINT IF EXISTS agency_departure_reports_voyage_id_port_key,
  DROP CONSTRAINT IF EXISTS agency_departure_reports_terminal_id_fkey,
  DROP CONSTRAINT IF EXISTS agency_departure_reports_terminal_port_fk,
  DROP CONSTRAINT IF EXISTS agency_departure_reports_terminal_pair_check;

ALTER TABLE public.agency_departure_reports
  ADD CONSTRAINT agency_departure_reports_terminal_port_fk
    FOREIGN KEY (terminal_id, terminal_port_id)
    REFERENCES public.depots(id, port_id) ON DELETE RESTRICT,
  ADD CONSTRAINT agency_departure_reports_terminal_pair_check
    CHECK (
      (terminal_id IS NULL AND terminal_port_id IS NULL)
      OR (terminal_id IS NOT NULL AND terminal_port_id IS NOT NULL)
    );

CREATE UNIQUE INDEX IF NOT EXISTS uq_agency_departure_reports_terminal
  ON public.agency_departure_reports (voyage_id, port, terminal_id)
  WHERE terminal_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_agency_departure_reports_legacy
  ON public.agency_departure_reports (voyage_id, port)
  WHERE terminal_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_agency_departure_reports_terminal
  ON public.agency_departure_reports (voyage_id, port, terminal_id);

DROP TRIGGER IF EXISTS validate_agency_departure_report_port ON public.agency_departure_reports;
CREATE TRIGGER validate_agency_departure_report_port
  BEFORE INSERT OR UPDATE ON public.agency_departure_reports
  FOR EACH ROW
  WHEN (NEW.terminal_id IS NOT NULL)
  EXECUTE FUNCTION public.validate_agency_departure_report_port();

-- A função legada não pode mais usar ON CONFLICT(voyage_id, port), pois a
-- unicidade agora é parcial. O lock da viagem mantém a criação legada segura.
CREATE OR REPLACE FUNCTION public.ensure_agency_departure_report(
  p_voyage_id BIGINT,
  p_port TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_report_id UUID;
  v_port TEXT := upper(btrim(COALESCE(p_port, '')));
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  IF v_port = '' THEN
    RAISE EXCEPTION 'Porto obrigatorio.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_report_id
  FROM public.agency_departure_reports
  WHERE voyage_id = p_voyage_id AND port = v_port AND terminal_id IS NULL
  FOR UPDATE;
  IF FOUND THEN
    RETURN v_report_id;
  END IF;

  INSERT INTO public.agency_departure_reports (voyage_id, port)
  VALUES (p_voyage_id, v_port)
  RETURNING id INTO v_report_id;
  RETURN v_report_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.ensure_agency_departure_report(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_agency_departure_report(BIGINT, TEXT) TO authenticated;

-- Task 4 integration point: esta guarda e somente uma precondition de close
-- para ADR terminalizado. Nao deve ser chamada por reopen/signoff; a Task 4
-- deve manter ramos explicitos para legado, reopen e signoff.
CREATE OR REPLACE FUNCTION public.assert_voyage_escala_ready_for_report_close(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_report_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_port TEXT := upper(btrim(COALESCE(p_port, '')));
  v_port_id BIGINT;
  v_report RECORD;
  v_terminal_code TEXT;
  v_terminal_tipo TEXT;
  v_terminal_port_id BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;

  SELECT p.id
  INTO v_port_id
  FROM public.ports AS p
  WHERE upper(btrim(p.locode)) = v_port
    AND upper(btrim(p.locode)) LIKE 'BR%'
  ORDER BY p.id
  LIMIT 1;
  IF v_port_id IS NULL THEN
    RAISE EXCEPTION 'Porto brasileiro % nao encontrado.', v_port USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  SELECT r.id, r.voyage_id, r.port, r.terminal_id, r.terminal_port_id
  INTO v_report
  FROM public.agency_departure_reports AS r
  WHERE r.id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report_id nao pertence a escala %::%.', p_voyage_id, v_port
      USING ERRCODE = '23514';
  END IF;
  IF v_report.voyage_id <> p_voyage_id
     OR upper(btrim(v_report.port)) <> v_port THEN
    RAISE EXCEPTION 'report_id nao pertence a escala %::%.', p_voyage_id, v_port
      USING ERRCODE = '23514';
  END IF;

  SELECT d.code, d.tipo, d.port_id
  INTO v_terminal_code, v_terminal_tipo, v_terminal_port_id
  FROM public.depots AS d
  WHERE d.id = v_report.terminal_id;
  IF v_report.terminal_id IS NULL OR v_report.terminal_port_id IS NULL THEN
    RAISE EXCEPTION 'report_id deve referenciar ADR terminalizado do porto %.', v_port
      USING ERRCODE = '23514';
  END IF;
  IF v_terminal_tipo IS DISTINCT FROM 'terminal_portuario'
     OR v_terminal_port_id IS DISTINCT FROM v_port_id
     OR v_report.terminal_port_id IS DISTINCT FROM v_port_id THEN
    RAISE EXCEPTION 'report_id deve referenciar ADR terminalizado do porto %.', v_port
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.voyage_escala_operation_fronts AS f
    WHERE f.voyage_id = p_voyage_id AND f.port = v_port AND f.terminal_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Frente TBC impede o fechamento do ADR.'
      USING ERRCODE = '23514', DETAIL = 'Atribua todas as frentes a um terminal antes do fechamento.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.voyage_escala_operation_fronts AS f
    WHERE f.voyage_id = p_voyage_id AND f.port = v_port
      AND f.terminal_id = v_report.terminal_id
  ) THEN
    RAISE EXCEPTION 'ADR % nao corresponde a terminal atribuido na escala.', v_terminal_code
      USING ERRCODE = '23514';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.assert_voyage_escala_ready_for_report_close(BIGINT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS actor_department TEXT;

ALTER TABLE public.voyage_escala_terminal_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voyage_escala_operation_fronts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voyage_escala_revision_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS voyage_escala_terminal_state_select ON public.voyage_escala_terminal_state;
CREATE POLICY voyage_escala_terminal_state_select
  ON public.voyage_escala_terminal_state
  FOR SELECT TO authenticated
  USING (public.is_active_read_user());

DROP POLICY IF EXISTS voyage_escala_operation_fronts_select ON public.voyage_escala_operation_fronts;
CREATE POLICY voyage_escala_operation_fronts_select
  ON public.voyage_escala_operation_fronts
  FOR SELECT TO authenticated
  USING (public.is_active_read_user());

DROP POLICY IF EXISTS voyage_escala_revision_state_select ON public.voyage_escala_revision_state;
CREATE POLICY voyage_escala_revision_state_select
  ON public.voyage_escala_revision_state
  FOR SELECT TO authenticated
  USING (public.is_active_read_user());

REVOKE ALL ON TABLE public.voyage_escala_terminal_state FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.voyage_escala_operation_fronts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.voyage_escala_revision_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.voyage_escala_terminal_state TO authenticated;
GRANT SELECT ON TABLE public.voyage_escala_operation_fronts TO authenticated;
GRANT SELECT ON TABLE public.voyage_escala_revision_state TO authenticated;

CREATE OR REPLACE FUNCTION public.save_voyage_escala_terminal_state(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_expected_revision INTEGER,
  p_fronts JSONB,
  p_terminals JSONB,
  p_export_expectation JSONB,
  p_justification TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_role TEXT;
  v_department TEXT;
  v_port TEXT := upper(btrim(COALESCE(p_port, '')));
  v_port_id BIGINT;
  v_current_revision INTEGER := 0;
  v_next_revision INTEGER;
  v_entity_id TEXT;
  v_front RECORD;
  v_old_front RECORD;
  v_new_front RECORD;
  v_terminal RECORD;
  v_old_terminal RECORD;
  v_depot RECORD;
  v_report RECORD;
  v_old_export_exists BOOLEAN := FALSE;
  v_old_export_declared BOOLEAN := FALSE;
  v_old_export_granite BOOLEAN := FALSE;
  v_old_export_empty BOOLEAN := FALSE;
  v_old_export_containers_qty INTEGER;
  v_old_export_movements_qty INTEGER;
  v_old_export_discharge_ports TEXT[] := '{}'::TEXT[];
  v_old_export_ce_status TEXT;
  v_old_export_linked BOOLEAN := FALSE;
  v_export_granite BOOLEAN := FALSE;
  v_export_empty BOOLEAN := FALSE;
  v_export_declared BOOLEAN := FALSE;
  v_export_containers_qty INTEGER;
  v_export_movements_qty INTEGER;
  v_export_discharge_ports TEXT[] := '{}'::TEXT[];
  v_export_ce_status TEXT;
  v_export_linked BOOLEAN := FALSE;
  v_export_old JSONB;
  v_export_new JSONB;
  v_current_terminal_assignment BOOLEAN;
  v_existing_terminal_state BOOLEAN;
  v_existing_front BOOLEAN;
  v_front_changed BOOLEAN;
  v_state_changed BOOLEAN;
  v_requires_justification BOOLEAN := FALSE;
  v_closed_blockers JSONB := '[]'::JSONB;
  v_report_id UUID;
  v_report_status TEXT;
  v_terminal_code TEXT;
  v_blocked_report_id UUID;
  v_schedule JSONB;
  v_schedule_entity_id TEXT;
  v_schedule_field TEXT;
  v_schedule_old_value TEXT;
  v_schedule_new_value TEXT;
  v_new_voyage_status TEXT;
  v_active_pods INTEGER;
  v_pending_pods INTEGER;
BEGIN
  SELECT up.role INTO v_role
  FROM public.user_profiles AS up
  WHERE up.id = auth.uid() AND up.active = TRUE;

  IF auth.uid() IS NULL OR v_role IS NULL
     OR v_role NOT IN ('admin', 'administrativo', 'operacoes', 'operator', 'documentacao', 'equipamentos', 'financeiro') THEN
    RAISE EXCEPTION 'Usuario ativo sem permissao para editar a escala.'
      USING ERRCODE = '42501';
  END IF;
  v_department := CASE
    WHEN v_role IN ('admin', 'administrativo') THEN 'administrativo'
    WHEN v_role = 'documentacao' THEN 'documentacao'
    WHEN v_role = 'equipamentos' THEN 'equipamentos'
    ELSE 'operacoes'
  END;
  v_entity_id := p_voyage_id::TEXT || '::' || v_port;

  IF p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'Revision esperada obrigatoria.' USING ERRCODE = '22023';
  END IF;
  IF p_fronts IS NULL OR jsonb_typeof(p_fronts) <> 'array'
     OR p_terminals IS NULL OR jsonb_typeof(p_terminals) <> 'array'
     OR p_export_expectation IS NULL OR jsonb_typeof(p_export_expectation) <> 'object'
     OR (p_export_expectation ? 'discharge_ports'
         AND jsonb_typeof(p_export_expectation->'discharge_ports') <> 'array')
     OR (p_export_expectation ? 'schedule'
         AND jsonb_typeof(p_export_expectation->'schedule') <> 'object') THEN
    RAISE EXCEPTION 'Payload de escala invalido.' USING ERRCODE = '22023';
  END IF;

  -- A escala física é a linha da viagem; o lock serializa todas as escritas
  -- terminais da mesma escala, mesmo quando ela ainda não tem state próprio.
  PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  SELECT p.id INTO v_port_id
  FROM public.ports AS p
  WHERE upper(btrim(p.locode)) = v_port
    AND upper(btrim(p.locode)) LIKE 'BR%'
  ORDER BY p.id
  LIMIT 1;
  IF v_port_id IS NULL THEN
    RAISE EXCEPTION 'Porto brasileiro % nao encontrado.', v_port USING ERRCODE = 'P0002';
  END IF;

  SELECT rs.revision
  INTO v_current_revision
  FROM public.voyage_escala_revision_state AS rs
  WHERE rs.voyage_id = p_voyage_id AND rs.port = v_port
  FOR UPDATE;
  IF NOT FOUND THEN
    v_current_revision := 0;
  END IF;
  IF p_expected_revision <> v_current_revision THEN
    RAISE EXCEPTION 'REVISAO_OBSOLETA: esperada %, atual %.', p_expected_revision, v_current_revision
      USING ERRCODE = 'P0001';
  END IF;
  v_next_revision := v_current_revision + 1;

  -- A declaração de exportação usa esta RPC para manter a mesma proteção de
  -- revisão, mas perfis operacionais já existentes não podem ganhar poder de
  -- trocar terminal/data só por passarem pelo caminho transacional. Eles
  -- podem alterar a expectativa exportadora; qualquer mudança de state físico
  -- continua exclusiva de Operações/Admin.
  IF v_role NOT IN ('admin', 'administrativo', 'operacoes') AND (
    EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
      LEFT JOIN public.voyage_escala_operation_fronts AS old_f
        ON old_f.voyage_id = p_voyage_id AND old_f.port = v_port
       AND old_f.sentido = lower(btrim(f.sentido))
       AND old_f.modalidade = lower(btrim(f.modalidade))
      WHERE f.terminal_id IS DISTINCT FROM old_f.terminal_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.voyage_escala_operation_fronts AS old_f
      WHERE old_f.voyage_id = p_voyage_id AND old_f.port = v_port
        AND old_f.terminal_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
          WHERE lower(btrim(f.sentido)) = old_f.sentido
            AND lower(btrim(f.modalidade)) = old_f.modalidade
        )
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_terminals) AS t(terminal_id UUID, terminal_atb TIMESTAMPTZ, terminal_atd TIMESTAMPTZ, terminal_rtw INTEGER)
      LEFT JOIN public.voyage_escala_terminal_state AS old_t
        ON old_t.voyage_id = p_voyage_id AND old_t.port = v_port AND old_t.terminal_id = t.terminal_id
      WHERE old_t.terminal_id IS NULL
         OR old_t.terminal_atb IS DISTINCT FROM t.terminal_atb
         OR old_t.terminal_atd IS DISTINCT FROM t.terminal_atd
         OR old_t.terminal_rtw IS DISTINCT FROM t.terminal_rtw
    )
    OR EXISTS (
      SELECT 1
      FROM public.voyage_escala_terminal_state AS old_t
      WHERE old_t.voyage_id = p_voyage_id AND old_t.port = v_port
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_to_recordset(p_terminals) AS t(terminal_id UUID, terminal_atb TIMESTAMPTZ, terminal_atd TIMESTAMPTZ, terminal_rtw INTEGER)
          WHERE t.terminal_id = old_t.terminal_id
        )
    )
  ) THEN
    RAISE EXCEPTION 'Somente Operações/Admin podem editar terminais da escala.' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
    GROUP BY lower(btrim(sentido)), lower(btrim(modalidade))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Frente duplicada na escala.' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_terminals) AS t(terminal_id UUID, terminal_atb TIMESTAMPTZ, terminal_atd TIMESTAMPTZ, terminal_rtw INTEGER)
    GROUP BY terminal_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Terminal duplicado no estado da escala.' USING ERRCODE = '23505';
  END IF;

  FOR v_front IN
    SELECT lower(btrim(f.sentido)) AS sentido,
           lower(btrim(f.modalidade)) AS modalidade,
           f.terminal_id,
           f.source
    FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
  LOOP
    IF NOT (
      (v_front.sentido = 'importacao' AND v_front.modalidade IN ('carga_cheia', 'carga_solta', 'vazio', 'veiculo'))
      OR (v_front.sentido = 'exportacao' AND v_front.modalidade IN ('granito', 'vazio'))
    ) THEN
      RAISE EXCEPTION 'Frente %/% invalida.', v_front.sentido, v_front.modalidade USING ERRCODE = '23514';
    END IF;
    IF (v_front.sentido = 'importacao' AND v_front.source <> 'operational_data')
       OR (v_front.sentido = 'exportacao' AND v_front.source <> 'export_declaration') THEN
      RAISE EXCEPTION 'Fonte invalida para a frente %/%.', v_front.sentido, v_front.modalidade USING ERRCODE = '23514';
    END IF;

    IF v_front.terminal_id IS NOT NULL THEN
      SELECT d.id, d.code, d.name, d.active, d.tipo, d.port_id
      INTO v_depot
      FROM public.depots AS d
      WHERE d.id = v_front.terminal_id AND d.port_id = v_port_id
        AND d.tipo = 'terminal_portuario';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Terminal nao pertence ao porto % ou nao e terminal portuario.', v_port
          USING ERRCODE = '23514';
      END IF;

      SELECT EXISTS (
        SELECT 1 FROM public.voyage_escala_terminal_state AS s
        WHERE s.voyage_id = p_voyage_id AND s.port = v_port AND s.terminal_id = v_front.terminal_id
      ) INTO v_existing_terminal_state;
      SELECT EXISTS (
        SELECT 1 FROM public.voyage_escala_operation_fronts AS old_f
        WHERE old_f.voyage_id = p_voyage_id AND old_f.port = v_port
          AND old_f.sentido = v_front.sentido
          AND old_f.modalidade = v_front.modalidade
          AND old_f.terminal_id = v_front.terminal_id
      ) INTO v_current_terminal_assignment;
      -- Histórico pode continuar apontando para terminal inativo; uma nova
      -- atribuição só aceita cadastro ativo.
      IF NOT v_current_terminal_assignment AND NOT v_depot.active THEN
        RAISE EXCEPTION 'Terminal inativo % nao pode receber nova atribuicao.', v_depot.code
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_fronts) AS f(
      sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT
    )
    WHERE f.terminal_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_terminals) AS t(
          terminal_id UUID, terminal_atb TIMESTAMPTZ, terminal_atd TIMESTAMPTZ, terminal_rtw INTEGER
        )
        WHERE t.terminal_id = f.terminal_id
      )
  ) THEN
    RAISE EXCEPTION 'Frente atribuida exige terminal no estado da escala.'
      USING ERRCODE = '23514';
  END IF;

  FOR v_terminal IN
    SELECT t.terminal_id, t.terminal_atb, t.terminal_atd, t.terminal_rtw
    FROM jsonb_to_recordset(p_terminals) AS t(
      terminal_id UUID,
      terminal_atb TIMESTAMPTZ,
      terminal_atd TIMESTAMPTZ,
      terminal_rtw INTEGER
    )
  LOOP
    SELECT d.id, d.code, d.name, d.active, d.tipo, d.port_id
    INTO v_depot
    FROM public.depots AS d
    WHERE d.id = v_terminal.terminal_id AND d.port_id = v_port_id
      AND d.tipo = 'terminal_portuario';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Terminal de estado nao pertence ao porto %.', v_port USING ERRCODE = '23514';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.voyage_escala_terminal_state AS s
      WHERE s.voyage_id = p_voyage_id AND s.port = v_port AND s.terminal_id = v_terminal.terminal_id
    ) INTO v_existing_terminal_state;
    IF NOT v_existing_terminal_state AND NOT v_depot.active THEN
      RAISE EXCEPTION 'Terminal inativo % nao pode receber novo estado.', v_depot.code
        USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
      WHERE f.terminal_id = v_terminal.terminal_id
    ) AND NOT v_existing_terminal_state THEN
      RAISE EXCEPTION 'Estado informado para terminal sem frente atribuida.' USING ERRCODE = '23514';
    END IF;
    IF v_terminal.terminal_atd IS NOT NULL
       AND (v_terminal.terminal_atb IS NULL OR v_terminal.terminal_atd < v_terminal.terminal_atb) THEN
      RAISE EXCEPTION 'terminal_atd < terminal_atb para o terminal %.', v_depot.code
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  SELECT COALESCE(ves.tem_exportacao, FALSE), COALESCE(ves.has_granite, FALSE), COALESCE(ves.has_empty, FALSE),
         ves.containers_qty, ves.movements_qty, COALESCE(ves.discharge_ports, '{}'::TEXT[]),
         ves.ce_status, COALESCE(ves.linked, FALSE)
  INTO v_old_export_declared, v_old_export_granite, v_old_export_empty,
       v_old_export_containers_qty, v_old_export_movements_qty, v_old_export_discharge_ports,
       v_old_export_ce_status, v_old_export_linked
  FROM public.voyage_export_schedules AS ves
  WHERE ves.voyage_id = p_voyage_id AND ves.pol = v_port
  FOR UPDATE;
  v_old_export_exists := FOUND;
  IF COALESCE(p_export_expectation, '{}'::JSONB) ? 'granito' THEN
    v_export_granite := COALESCE((p_export_expectation->>'granito')::BOOLEAN, FALSE);
  ELSE
    v_export_granite := EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
      WHERE lower(btrim(f.sentido)) = 'exportacao' AND lower(btrim(f.modalidade)) = 'granito'
    );
  END IF;
  IF COALESCE(p_export_expectation, '{}'::JSONB) ? 'has_empty' THEN
    v_export_empty := COALESCE((p_export_expectation->>'has_empty')::BOOLEAN, FALSE);
  ELSIF COALESCE(p_export_expectation, '{}'::JSONB) ? 'vazios' THEN
    v_export_empty := COALESCE((p_export_expectation->>'vazios')::BOOLEAN, FALSE);
  ELSE
    v_export_empty := EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
      WHERE lower(btrim(f.sentido)) = 'exportacao' AND lower(btrim(f.modalidade)) = 'vazio'
    );
  END IF;
  IF (COALESCE(p_export_expectation, '{}'::JSONB) ? 'has_empty')
     AND (COALESCE(p_export_expectation, '{}'::JSONB) ? 'vazios')
     AND COALESCE((p_export_expectation->>'has_empty')::BOOLEAN, FALSE)
         IS DISTINCT FROM COALESCE((p_export_expectation->>'vazios')::BOOLEAN, FALSE) THEN
    RAISE EXCEPTION 'Expectativas de vazios divergentes.' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(p_export_expectation, '{}'::JSONB) ? 'tem_exportacao' THEN
    v_export_declared := COALESCE((p_export_expectation->>'tem_exportacao')::BOOLEAN, FALSE);
    IF NOT v_export_declared AND (v_export_granite OR v_export_empty) THEN
      RAISE EXCEPTION 'Expectativa de exportacao desligada com frente declarada.' USING ERRCODE = '23514';
    END IF;
    IF v_export_declared AND NOT (v_export_granite OR v_export_empty)
       AND NOT (v_old_export_exists AND v_old_export_declared
                AND NOT v_old_export_granite AND NOT v_old_export_empty) THEN
      RAISE EXCEPTION 'Nova expectativa de exportacao exige granito ou vazios.' USING ERRCODE = '23514';
    END IF;
  ELSE
    v_export_declared := v_export_granite OR v_export_empty;
  END IF;

  v_export_containers_qty := CASE
    WHEN COALESCE(p_export_expectation, '{}'::JSONB) ? 'containers_qty'
      THEN (p_export_expectation->>'containers_qty')::INTEGER
    ELSE v_old_export_containers_qty
  END;
  v_export_movements_qty := CASE
    WHEN COALESCE(p_export_expectation, '{}'::JSONB) ? 'movements_qty'
      THEN (p_export_expectation->>'movements_qty')::INTEGER
    ELSE v_old_export_movements_qty
  END;
  v_export_discharge_ports := CASE
    WHEN COALESCE(p_export_expectation, '{}'::JSONB) ? 'discharge_ports'
      THEN COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(p_export_expectation->'discharge_ports')),
        '{}'::TEXT[]
      )
    ELSE v_old_export_discharge_ports
  END;
  v_export_ce_status := CASE
    WHEN COALESCE(p_export_expectation, '{}'::JSONB) ? 'ce_status'
      THEN p_export_expectation->>'ce_status'
    ELSE v_old_export_ce_status
  END;
  v_export_linked := CASE
    WHEN COALESCE(p_export_expectation, '{}'::JSONB) ? 'linked'
      THEN COALESCE((p_export_expectation->>'linked')::BOOLEAN, FALSE)
    ELSE v_old_export_linked
  END;
  IF v_export_granite AND NOT EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
    WHERE lower(btrim(f.sentido)) = 'exportacao' AND lower(btrim(f.modalidade)) = 'granito'
  ) THEN
    RAISE EXCEPTION 'Expectativa de granito exige a frente exportacao/granito.' USING ERRCODE = '23514';
  END IF;
  IF v_export_empty AND NOT EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
    WHERE lower(btrim(f.sentido)) = 'exportacao' AND lower(btrim(f.modalidade)) = 'vazio'
  ) THEN
    RAISE EXCEPTION 'Expectativa de vazios exige a frente exportacao/vazio.' USING ERRCODE = '23514';
  END IF;

  v_export_old := jsonb_build_object(
    'tem_exportacao', v_old_export_declared,
    'granito', v_old_export_granite,
    'vazios', v_old_export_empty,
    'has_empty', v_old_export_empty,
    'containers_qty', v_old_export_containers_qty,
    'movements_qty', v_old_export_movements_qty,
    'discharge_ports', v_old_export_discharge_ports,
    'ce_status', v_old_export_ce_status,
    'linked', v_old_export_linked
  );
  v_export_new := jsonb_build_object(
    'tem_exportacao', v_export_declared,
    'granito', v_export_granite,
    'vazios', v_export_empty,
    'has_empty', v_export_empty,
    'containers_qty', v_export_containers_qty,
    'movements_qty', v_export_movements_qty,
    'discharge_ports', v_export_discharge_ports,
    'ce_status', v_export_ce_status,
    'linked', v_export_linked
  );
  IF v_export_old IS DISTINCT FROM v_export_new THEN
    v_requires_justification := v_current_revision > 0;
  END IF;

  -- Primeiro compara tudo. Nenhuma escrita, nem de uma frente, acontece
  -- antes de terminar a checagem de ADR fechado.
  FOR v_old_front IN
    SELECT old_f.sentido, old_f.modalidade, old_f.terminal_id, old_f.source
    FROM public.voyage_escala_operation_fronts AS old_f
    WHERE old_f.voyage_id = p_voyage_id AND old_f.port = v_port
  LOOP
    SELECT lower(btrim(f.sentido)) AS sentido,
           lower(btrim(f.modalidade)) AS modalidade,
           f.terminal_id,
           f.source
    INTO v_new_front
    FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
    WHERE lower(btrim(f.sentido)) = v_old_front.sentido
      AND lower(btrim(f.modalidade)) = v_old_front.modalidade;
    v_existing_front := FOUND;
    IF NOT v_existing_front THEN
      v_front_changed := TRUE;
    ELSE
      v_front_changed := v_old_front.terminal_id IS DISTINCT FROM v_new_front.terminal_id
        OR v_old_front.source IS DISTINCT FROM v_new_front.source;
    END IF;
    IF v_front_changed THEN
      v_requires_justification := v_current_revision > 0;
      IF v_old_front.terminal_id IS NOT NULL THEN
        SELECT d.code, r.id
        INTO v_terminal_code, v_blocked_report_id
        FROM public.agency_departure_reports AS r
        JOIN public.depots AS d ON d.id = r.terminal_id
        WHERE r.voyage_id = p_voyage_id AND r.port = v_port
          AND r.terminal_id = v_old_front.terminal_id AND r.status = 'closed'
        LIMIT 1;
        IF FOUND THEN
          v_closed_blockers := v_closed_blockers || jsonb_build_array(jsonb_build_object(
            'terminal_code', v_terminal_code, 'report_id', v_blocked_report_id,
            'reason', 'front_change'
          ));
        END IF;
      END IF;
    END IF;
  END LOOP;

  FOR v_front IN
    SELECT lower(btrim(f.sentido)) AS sentido,
           lower(btrim(f.modalidade)) AS modalidade,
           f.terminal_id,
           f.source
    FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
  LOOP
    SELECT old_f.terminal_id, old_f.source
    INTO v_old_front
    FROM public.voyage_escala_operation_fronts AS old_f
    WHERE old_f.voyage_id = p_voyage_id AND old_f.port = v_port
      AND old_f.sentido = v_front.sentido AND old_f.modalidade = v_front.modalidade;
    v_existing_front := FOUND;
    IF NOT v_existing_front THEN
      v_front_changed := TRUE;
    ELSE
      v_front_changed := v_old_front.terminal_id IS DISTINCT FROM v_front.terminal_id
        OR v_old_front.source IS DISTINCT FROM v_front.source;
    END IF;
    IF v_front_changed AND v_front.terminal_id IS NOT NULL THEN
      SELECT d.code, r.id
      INTO v_terminal_code, v_blocked_report_id
      FROM public.agency_departure_reports AS r
      JOIN public.depots AS d ON d.id = r.terminal_id
      WHERE r.voyage_id = p_voyage_id AND r.port = v_port
        AND r.terminal_id = v_front.terminal_id AND r.status = 'closed'
      LIMIT 1;
      IF FOUND THEN
        v_closed_blockers := v_closed_blockers || jsonb_build_array(jsonb_build_object(
          'terminal_code', v_terminal_code, 'report_id', v_blocked_report_id,
          'reason', 'front_change'
        ));
      END IF;
    END IF;
  END LOOP;

  FOR v_terminal IN
    SELECT t.terminal_id, t.terminal_atb, t.terminal_atd, t.terminal_rtw
    FROM jsonb_to_recordset(p_terminals) AS t(
      terminal_id UUID, terminal_atb TIMESTAMPTZ, terminal_atd TIMESTAMPTZ, terminal_rtw INTEGER
    )
  LOOP
    SELECT s.terminal_atb, s.terminal_atd, s.terminal_rtw
    INTO v_old_terminal
    FROM public.voyage_escala_terminal_state AS s
    WHERE s.voyage_id = p_voyage_id AND s.port = v_port AND s.terminal_id = v_terminal.terminal_id;
    v_existing_terminal_state := FOUND;
    IF NOT v_existing_terminal_state THEN
      v_state_changed := TRUE;
    ELSE
      v_state_changed := v_old_terminal.terminal_atb IS DISTINCT FROM v_terminal.terminal_atb
        OR v_old_terminal.terminal_atd IS DISTINCT FROM v_terminal.terminal_atd
        OR v_old_terminal.terminal_rtw IS DISTINCT FROM v_terminal.terminal_rtw;
    END IF;
    IF v_state_changed THEN
      v_requires_justification := v_current_revision > 0;
      SELECT d.code, r.id
      INTO v_terminal_code, v_blocked_report_id
      FROM public.agency_departure_reports AS r
      JOIN public.depots AS d ON d.id = r.terminal_id
      WHERE r.voyage_id = p_voyage_id AND r.port = v_port
        AND r.terminal_id = v_terminal.terminal_id AND r.status = 'closed'
      LIMIT 1;
      IF FOUND THEN
        v_closed_blockers := v_closed_blockers || jsonb_build_array(jsonb_build_object(
          'terminal_code', v_terminal_code, 'report_id', v_blocked_report_id,
          'reason', 'terminal_dates'
        ));
      END IF;
    END IF;
  END LOOP;

  IF v_export_old IS DISTINCT FROM v_export_new AND v_current_revision > 0 THEN
    v_requires_justification := TRUE;
    FOR v_report IN
      SELECT DISTINCT r.id, r.terminal_id, d.code
      FROM public.agency_departure_reports AS r
      JOIN public.depots AS d ON d.id = r.terminal_id
      WHERE r.voyage_id = p_voyage_id AND r.port = v_port AND r.status = 'closed'
        AND r.terminal_id IN (
          SELECT f.terminal_id
          FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
          WHERE f.terminal_id IS NOT NULL
          UNION
          SELECT old_f.terminal_id
          FROM public.voyage_escala_operation_fronts AS old_f
          WHERE old_f.voyage_id = p_voyage_id AND old_f.port = v_port AND old_f.terminal_id IS NOT NULL
        )
    LOOP
      v_closed_blockers := v_closed_blockers || jsonb_build_array(jsonb_build_object(
        'terminal_code', v_report.code, 'report_id', v_report.id,
        'reason', 'export_expectation'
      ));
    END LOOP;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      blocker
      ORDER BY blocker->>'terminal_code', blocker->>'reason', blocker->>'report_id'
    ),
    '[]'::JSONB
  )
  INTO v_closed_blockers
  FROM jsonb_array_elements(v_closed_blockers) AS blockers(blocker);

  IF jsonb_array_length(v_closed_blockers) > 0 THEN
    -- A tentativa bloqueada não escreve nada: a UI recebe o contrato estável
    -- e pode traduzir terminal_code/report_id sem parsear DETAIL.
    RETURN jsonb_build_object(
      'revision', v_current_revision,
      'fronts', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'sentido', f.sentido, 'modalidade', f.modalidade,
          'terminal_id', f.terminal_id, 'source', f.source,
          'last_changed_at', f.last_changed_at, 'last_changed_by', f.last_changed_by,
          'revision', f.revision
        ) ORDER BY f.sentido, f.modalidade)
        FROM public.voyage_escala_operation_fronts AS f
        WHERE f.voyage_id = p_voyage_id AND f.port = v_port
      ), '[]'::JSONB),
      'terminals', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'terminal_id', s.terminal_id, 'code', d.code, 'name', d.name,
          'active', d.active, 'port_id', s.port_id,
          'terminal_atb', s.terminal_atb, 'terminal_atd', s.terminal_atd,
          'terminal_rtw', s.terminal_rtw, 'revision', s.revision,
          'report_id', r.id
        ) ORDER BY s.terminal_atb NULLS LAST, d.code)
        FROM public.voyage_escala_terminal_state AS s
        JOIN public.depots AS d ON d.id = s.terminal_id
        LEFT JOIN public.agency_departure_reports AS r
          ON r.voyage_id = s.voyage_id AND r.port = s.port AND r.terminal_id = s.terminal_id
        WHERE s.voyage_id = p_voyage_id AND s.port = v_port
      ), '[]'::JSONB),
      'closed_blockers', v_closed_blockers,
      'blocked', TRUE
    );
  END IF;
  IF v_requires_justification AND NULLIF(btrim(COALESCE(p_justification, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Justificativa obrigatoria para alterar estado terminalizado existente.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.voyage_escala_revision_state (voyage_id, port, port_id, revision)
  VALUES (p_voyage_id, v_port, v_port_id, 0)
  ON CONFLICT (voyage_id, port) DO NOTHING;

  -- O conjunto recebido representa todos os terminais ainda atribuídos a
  -- frentes. Remover os ausentes evita que ATB/ATD órfãos continuem visíveis
  -- no Line-Up e que a FK contra depots impeça a limpeza do terminal.
  FOR v_old_terminal IN
    SELECT s.*
    FROM public.voyage_escala_terminal_state AS s
    WHERE s.voyage_id = p_voyage_id AND s.port = v_port
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_terminals) AS t(terminal_id UUID, terminal_atb TIMESTAMPTZ, terminal_atd TIMESTAMPTZ, terminal_rtw INTEGER)
        WHERE t.terminal_id = s.terminal_id
      )
  LOOP
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value,
      changed_by, changed_at, justification, actor_role, actor_department
    )
    VALUES (
      'voyage_pod_schedule', v_entity_id, 'terminal_state_removed',
      jsonb_build_object(
        'terminal_id', v_old_terminal.terminal_id,
        'terminal_atb', v_old_terminal.terminal_atb,
        'terminal_atd', v_old_terminal.terminal_atd,
        'terminal_rtw', v_old_terminal.terminal_rtw
      )::TEXT,
      NULL, auth.uid(), clock_timestamp(), p_justification, v_role, v_department
    );
    DELETE FROM public.voyage_escala_terminal_state
    WHERE voyage_id = p_voyage_id AND port = v_port AND terminal_id = v_old_terminal.terminal_id;
  END LOOP;

  UPDATE public.voyage_escala_revision_state
  SET revision = v_next_revision, updated_at = now()
  WHERE voyage_id = p_voyage_id AND port = v_port;

  UPDATE public.voyage_escala_terminal_state
  SET revision = v_next_revision, updated_at = now()
  WHERE voyage_id = p_voyage_id AND port = v_port;

  FOR v_terminal IN
    SELECT t.terminal_id, t.terminal_atb, t.terminal_atd, t.terminal_rtw
    FROM jsonb_to_recordset(p_terminals) AS t(
      terminal_id UUID, terminal_atb TIMESTAMPTZ, terminal_atd TIMESTAMPTZ, terminal_rtw INTEGER
    )
  LOOP
    SELECT s.terminal_atb, s.terminal_atd, s.terminal_rtw
    INTO v_old_terminal
    FROM public.voyage_escala_terminal_state AS s
    WHERE s.voyage_id = p_voyage_id AND s.port = v_port AND s.terminal_id = v_terminal.terminal_id;
    v_existing_terminal_state := FOUND;
    INSERT INTO public.voyage_escala_terminal_state (
      voyage_id, port, port_id, terminal_id, terminal_atb, terminal_atd, terminal_rtw, revision
    )
    VALUES (
      p_voyage_id, v_port, v_port_id, v_terminal.terminal_id,
      v_terminal.terminal_atb, v_terminal.terminal_atd, v_terminal.terminal_rtw, v_next_revision
    )
    ON CONFLICT (voyage_id, port, terminal_id) DO UPDATE SET
      port_id = EXCLUDED.port_id,
      terminal_atb = EXCLUDED.terminal_atb,
      terminal_atd = EXCLUDED.terminal_atd,
      terminal_rtw = EXCLUDED.terminal_rtw,
      revision = EXCLUDED.revision,
      updated_at = now();

    IF NOT v_existing_terminal_state THEN
      v_state_changed := TRUE;
    ELSE
      v_state_changed := v_old_terminal.terminal_atb IS DISTINCT FROM v_terminal.terminal_atb
        OR v_old_terminal.terminal_atd IS DISTINCT FROM v_terminal.terminal_atd
        OR v_old_terminal.terminal_rtw IS DISTINCT FROM v_terminal.terminal_rtw;
    END IF;

    IF v_state_changed THEN
      INSERT INTO public.audit_logs (
        entity_type, entity_id, field_name, old_value, new_value,
        changed_by, changed_at, justification, actor_role, actor_department
      )
      VALUES (
        'voyage_pod_schedule', v_entity_id, 'terminal_dates',
        CASE WHEN v_existing_terminal_state THEN jsonb_build_object(
          'terminal_id', v_terminal.terminal_id,
          'terminal_atb', v_old_terminal.terminal_atb,
          'terminal_atd', v_old_terminal.terminal_atd,
          'terminal_rtw', v_old_terminal.terminal_rtw
        )::TEXT ELSE NULL END,
        jsonb_build_object(
          'terminal_id', v_terminal.terminal_id,
          'terminal_atb', v_terminal.terminal_atb,
          'terminal_atd', v_terminal.terminal_atd,
          'terminal_rtw', v_terminal.terminal_rtw
        )::TEXT,
        auth.uid(), clock_timestamp(), p_justification, v_role, v_department
      );
    END IF;
  END LOOP;

  FOR v_old_front IN
    SELECT old_f.*
    FROM public.voyage_escala_operation_fronts AS old_f
    WHERE old_f.voyage_id = p_voyage_id AND old_f.port = v_port
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
        WHERE lower(btrim(f.sentido)) = old_f.sentido
          AND lower(btrim(f.modalidade)) = old_f.modalidade
      )
  LOOP
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value,
      changed_by, changed_at, justification, actor_role, actor_department
    )
    VALUES (
      'voyage_pod_schedule', v_entity_id, 'front_removed', to_jsonb(v_old_front)::TEXT, NULL,
      auth.uid(), clock_timestamp(), p_justification, v_role, v_department
    );
    DELETE FROM public.voyage_escala_operation_fronts WHERE id = v_old_front.id;
  END LOOP;

  FOR v_front IN
    SELECT lower(btrim(f.sentido)) AS sentido,
           lower(btrim(f.modalidade)) AS modalidade,
           f.terminal_id,
           f.source
    FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
  LOOP
    SELECT old_f.*
    INTO v_old_front
    FROM public.voyage_escala_operation_fronts AS old_f
    WHERE old_f.voyage_id = p_voyage_id AND old_f.port = v_port
      AND old_f.sentido = v_front.sentido AND old_f.modalidade = v_front.modalidade;
    v_existing_front := FOUND;

    INSERT INTO public.voyage_escala_operation_fronts (
      voyage_id, port, port_id, sentido, modalidade, terminal_id, source,
      revision, last_changed_at, last_changed_by
    )
    VALUES (
      p_voyage_id, v_port, v_port_id, v_front.sentido, v_front.modalidade,
      v_front.terminal_id, v_front.source, v_next_revision, clock_timestamp(), auth.uid()
    )
    ON CONFLICT (voyage_id, port, sentido, modalidade) DO UPDATE SET
      port_id = EXCLUDED.port_id,
      terminal_id = EXCLUDED.terminal_id,
      source = EXCLUDED.source,
      revision = EXCLUDED.revision,
      last_changed_at = EXCLUDED.last_changed_at,
      last_changed_by = EXCLUDED.last_changed_by,
      updated_at = now();

    IF NOT v_existing_front THEN
      INSERT INTO public.audit_logs (
        entity_type, entity_id, field_name, old_value, new_value,
        changed_by, changed_at, justification, actor_role, actor_department
      )
      VALUES (
        'voyage_pod_schedule', v_entity_id, 'front_created', NULL,
        jsonb_build_object('sentido', v_front.sentido, 'modalidade', v_front.modalidade,
                           'terminal_id', v_front.terminal_id, 'source', v_front.source)::TEXT,
        auth.uid(), clock_timestamp(), p_justification, v_role, v_department
      );
    ELSE
      IF v_old_front.terminal_id IS DISTINCT FROM v_front.terminal_id THEN
        INSERT INTO public.audit_logs (
          entity_type, entity_id, field_name, old_value, new_value,
          changed_by, changed_at, justification, actor_role, actor_department
        )
        VALUES (
          'voyage_pod_schedule', v_entity_id, 'terminal_assignment',
          jsonb_build_object(
            'terminal_id', v_old_front.terminal_id,
            'terminal_code', (SELECT d.code FROM public.depots AS d WHERE d.id = v_old_front.terminal_id)
          )::TEXT,
          jsonb_build_object(
            'terminal_id', v_front.terminal_id,
            'terminal_code', (SELECT d.code FROM public.depots AS d WHERE d.id = v_front.terminal_id)
          )::TEXT,
          auth.uid(), clock_timestamp(), p_justification, v_role, v_department
        );
      END IF;
      IF v_old_front.source IS DISTINCT FROM v_front.source THEN
        INSERT INTO public.audit_logs (
          entity_type, entity_id, field_name, old_value, new_value,
          changed_by, changed_at, justification, actor_role, actor_department
        )
        VALUES (
          'voyage_pod_schedule', v_entity_id, 'front_source',
          v_old_front.source, v_front.source,
          auth.uid(), clock_timestamp(), p_justification, v_role, v_department
        );
      END IF;
    END IF;
  END LOOP;

  IF p_export_expectation IS NOT NULL OR v_old_export_exists OR v_export_declared THEN
    IF (p_export_expectation IS NOT NULL OR v_export_declared)
       AND (NOT v_old_export_exists OR v_export_old IS DISTINCT FROM v_export_new) THEN
      INSERT INTO public.audit_logs (
        entity_type, entity_id, field_name, old_value, new_value,
        changed_by, changed_at, justification, actor_role, actor_department
      )
      VALUES (
        'voyage_pod_schedule', v_entity_id, 'export_expectation',
        CASE WHEN v_old_export_exists THEN v_export_old::TEXT ELSE NULL END,
        v_export_new::TEXT,
        auth.uid(), clock_timestamp(), p_justification, v_role, v_department
      );
    END IF;
    INSERT INTO public.voyage_export_schedules (
      voyage_id, pol, tem_exportacao, has_granite, has_empty,
      containers_qty, movements_qty, discharge_ports, ce_status, linked, updated_at
    )
    VALUES (
      p_voyage_id, v_port, v_export_declared, v_export_granite, v_export_empty,
      v_export_containers_qty, v_export_movements_qty, v_export_discharge_ports,
      v_export_ce_status, v_export_linked, now()
    )
    ON CONFLICT (voyage_id, pol) DO UPDATE SET
      tem_exportacao = EXCLUDED.tem_exportacao,
      has_granite = EXCLUDED.has_granite,
      has_empty = EXCLUDED.has_empty,
      containers_qty = EXCLUDED.containers_qty,
      movements_qty = EXCLUDED.movements_qty,
      discharge_ports = EXCLUDED.discharge_ports,
      ce_status = EXCLUDED.ce_status,
      linked = EXCLUDED.linked,
      updated_at = now();
  END IF;

  -- O editor terminalizado envia também o snapshot dos campos do POD. Como
  -- esta função já segura o lock da escala, os audit rows são gravados na
  -- mesma transação das frentes, evitando o estado parcial antigo (frentes
  -- salvas, datas do POD falhando em uma segunda chamada).
  v_schedule := p_export_expectation->'schedule';
  IF v_schedule IS NOT NULL THEN
    v_schedule_entity_id := p_voyage_id::TEXT || '::' || v_port;
    FOREACH v_schedule_field IN ARRAY ARRAY[
      'eta', 'etb', 'ata', 'atb', 'etd', 'atd', 'rtw', 'ces',
      'linked', 'escala_number', 'tem_importacao', 'deleted'
    ] LOOP
      IF v_schedule ? v_schedule_field THEN
        SELECT al.new_value
        INTO v_schedule_old_value
        FROM public.audit_logs AS al
        WHERE al.entity_type = 'voyage_pod_schedule'
          AND al.entity_id = v_schedule_entity_id
          AND al.field_name = v_schedule_field
        ORDER BY al.changed_at DESC, al.id DESC
        LIMIT 1;
        v_schedule_new_value := CASE
          WHEN v_schedule->v_schedule_field IS NULL OR v_schedule->v_schedule_field = 'null'::JSONB THEN NULL
          ELSE v_schedule->>v_schedule_field
        END;
        -- O editor sempre envia deleted=false para retirar um soft-delete,
        -- mas isso não deve gerar uma linha de auditoria em cada salvamento.
        IF v_schedule_field = 'deleted'
           AND v_schedule_new_value = 'false'
           AND v_schedule_old_value IS DISTINCT FROM 'true' THEN
          CONTINUE;
        END IF;
        IF v_schedule_old_value IS DISTINCT FROM v_schedule_new_value THEN
          INSERT INTO public.audit_logs (
            entity_type, entity_id, field_name, old_value, new_value,
            changed_by, changed_at, justification, actor_role, actor_department
          )
          VALUES (
            'voyage_pod_schedule', v_schedule_entity_id, v_schedule_field,
            v_schedule_old_value, v_schedule_new_value,
            auth.uid(), clock_timestamp(), p_justification, v_role, v_department
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- O caminho terminalizado já gravou o ATD na mesma transação. Recalcula o
  -- status da viagem aqui para manter o contrato do save legado sem uma
  -- segunda chamada sujeita a observar um snapshot parcial.
  IF v_schedule ? 'atd' THEN
    WITH pod_entities AS (
      SELECT DISTINCT al.entity_id
      FROM public.audit_logs AS al
      WHERE al.entity_type = 'voyage_pod_schedule'
        AND split_part(al.entity_id, '::', 1)::BIGINT = p_voyage_id
    ), latest_atd AS (
      SELECT DISTINCT ON (al.entity_id) al.entity_id, NULLIF(btrim(al.new_value), '') AS atd
      FROM public.audit_logs AS al
      WHERE al.entity_type = 'voyage_pod_schedule'
        AND al.field_name = 'atd'
        AND split_part(al.entity_id, '::', 1)::BIGINT = p_voyage_id
      ORDER BY al.entity_id, al.changed_at DESC, al.id DESC
    ), latest_omitted AS (
      SELECT DISTINCT ON (al.entity_id) al.entity_id, al.new_value
      FROM public.audit_logs AS al
      WHERE al.entity_type = 'voyage_pod_schedule'
        AND al.field_name = 'omitted'
        AND split_part(al.entity_id, '::', 1)::BIGINT = p_voyage_id
      ORDER BY al.entity_id, al.changed_at DESC, al.id DESC
    ), latest_deleted AS (
      SELECT DISTINCT ON (al.entity_id) al.entity_id, al.new_value
      FROM public.audit_logs AS al
      WHERE al.entity_type = 'voyage_pod_schedule'
        AND al.field_name = 'deleted'
        AND split_part(al.entity_id, '::', 1)::BIGINT = p_voyage_id
      ORDER BY al.entity_id, al.changed_at DESC, al.id DESC
    ), active AS (
      SELECT e.entity_id, a.atd
      FROM pod_entities AS e
      LEFT JOIN latest_atd AS a ON a.entity_id = e.entity_id
      LEFT JOIN latest_omitted AS o ON o.entity_id = e.entity_id
      LEFT JOIN latest_deleted AS d ON d.entity_id = e.entity_id
      WHERE COALESCE(o.new_value, 'false') <> 'true'
        AND COALESCE(d.new_value, 'false') <> 'true'
    )
    SELECT COUNT(*)::INTEGER, COUNT(*) FILTER (WHERE NULLIF(btrim(atd), '') IS NULL)::INTEGER
    INTO v_active_pods, v_pending_pods
    FROM active;

    IF v_active_pods > 0 THEN
      v_new_voyage_status := CASE WHEN v_pending_pods = 0 THEN 'completed' ELSE 'active' END;
      UPDATE public.voyages
      SET status = v_new_voyage_status
      WHERE id = p_voyage_id
        AND status <> 'cancelled'
        AND status IS DISTINCT FROM v_new_voyage_status;
    END IF;
  END IF;

  -- A primeira frente cria/reutiliza o ADR do terminal. Um ADR aberto sem
  -- frentes é o único que pode ser removido; ADR fechado fica preservado.
  FOR v_depot IN
    SELECT DISTINCT f.terminal_id, d.code, d.name, d.port_id
    FROM public.voyage_escala_operation_fronts AS f
    JOIN public.depots AS d ON d.id = f.terminal_id
    WHERE f.voyage_id = p_voyage_id AND f.port = v_port AND f.terminal_id IS NOT NULL
  LOOP
    SELECT r.id, r.status INTO v_report_id, v_report_status
    FROM public.agency_departure_reports AS r
    WHERE r.voyage_id = p_voyage_id AND r.port = v_port AND r.terminal_id = v_depot.terminal_id
    FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.agency_departure_reports (
        voyage_id, port, terminal, terminal_id, terminal_port_id
      )
      VALUES (p_voyage_id, v_port, v_depot.code, v_depot.terminal_id, v_depot.port_id)
      ON CONFLICT (voyage_id, port, terminal_id) WHERE terminal_id IS NOT NULL
      DO UPDATE SET terminal = EXCLUDED.terminal
      RETURNING id INTO v_report_id;
      INSERT INTO public.audit_logs (
        entity_type, entity_id, field_name, old_value, new_value,
        changed_by, changed_at, justification, actor_role, actor_department
      )
      VALUES (
        'voyage_pod_schedule', v_entity_id, 'adr_created', NULL,
        jsonb_build_object('terminal_code', v_depot.code, 'report_id', v_report_id)::TEXT,
        auth.uid(), clock_timestamp(), p_justification, v_role, v_department
      );
    END IF;
  END LOOP;

  FOR v_report IN
    SELECT r.id, r.terminal_id, r.status, d.code
    FROM public.agency_departure_reports AS r
    JOIN public.depots AS d ON d.id = r.terminal_id
    WHERE r.voyage_id = p_voyage_id AND r.port = v_port
      AND r.terminal_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.voyage_escala_operation_fronts AS f
        WHERE f.voyage_id = p_voyage_id AND f.port = v_port
          AND f.terminal_id = r.terminal_id
      )
    FOR UPDATE OF r
  LOOP
    IF v_report.status = 'open' THEN
      -- Um ADR aberto só pode ser removido quando não há filhos, histórico ou
      -- alertas associados. Qualquer alerta do ADR, em qualquer status, preserva
      -- o registro para não perder o histórico operacional.
      IF NOT EXISTS (
        SELECT 1
        FROM public.agency_departure_report_signoffs
        WHERE report_id = v_report.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.agency_departure_report_department_signoffs
        WHERE report_id = v_report.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.agency_departure_report_occurrences
        WHERE report_id = v_report.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.audit_logs AS al
        WHERE al.entity_id = v_report.id::TEXT
           OR (
             (al.old_value ILIKE '%' || v_report.id::TEXT || '%'
              OR al.new_value ILIKE '%' || v_report.id::TEXT || '%')
             AND NOT (
               al.entity_type = 'voyage_pod_schedule'
               AND al.field_name IN ('adr_created', 'adr_removed', 'adr_preserved')
             )
           )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.alerts AS a
        WHERE a.entity_type = 'agency_departure_report'
          AND a.entity_id LIKE public.agency_report_alert_entity_prefix(p_voyage_id, v_port, v_report.code) || '%'
      ) THEN
        INSERT INTO public.audit_logs (
          entity_type, entity_id, field_name, old_value, new_value,
          changed_by, changed_at, justification, actor_role, actor_department
        )
        VALUES (
          'voyage_pod_schedule', v_entity_id, 'adr_removed',
          jsonb_build_object('terminal_code', v_report.code, 'report_id', v_report.id)::TEXT,
          NULL, auth.uid(), clock_timestamp(), p_justification, v_role, v_department
        );
        DELETE FROM public.agency_departure_reports
        WHERE id = v_report.id AND status = 'open';
      ELSE
        INSERT INTO public.audit_logs (
          entity_type, entity_id, field_name, old_value, new_value,
          changed_by, changed_at, justification, actor_role, actor_department
        )
        VALUES (
          'voyage_pod_schedule', v_entity_id, 'adr_preserved',
          jsonb_build_object('terminal_code', v_report.code, 'report_id', v_report.id)::TEXT,
          'dependentes ou historico preservados', auth.uid(), clock_timestamp(),
          p_justification, v_role, v_department
        );
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'revision', v_next_revision,
    'fronts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'sentido', f.sentido, 'modalidade', f.modalidade,
        'terminal_id', f.terminal_id, 'source', f.source,
        'last_changed_at', f.last_changed_at, 'last_changed_by', f.last_changed_by,
        'revision', f.revision
      ) ORDER BY f.sentido, f.modalidade)
      FROM public.voyage_escala_operation_fronts AS f
      WHERE f.voyage_id = p_voyage_id AND f.port = v_port
    ), '[]'::JSONB),
    'terminals', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'terminal_id', s.terminal_id, 'code', d.code, 'name', d.name,
        'active', d.active, 'port_id', s.port_id,
        'terminal_atb', s.terminal_atb, 'terminal_atd', s.terminal_atd,
        'terminal_rtw', s.terminal_rtw, 'revision', s.revision,
        'report_id', r.id
      ) ORDER BY s.terminal_atb NULLS LAST, d.code)
      FROM public.voyage_escala_terminal_state AS s
      JOIN public.depots AS d ON d.id = s.terminal_id
      LEFT JOIN public.agency_departure_reports AS r
        ON r.voyage_id = s.voyage_id AND r.port = s.port AND r.terminal_id = s.terminal_id
      WHERE s.voyage_id = p_voyage_id AND s.port = v_port
    ), '[]'::JSONB),
    'closed_blockers', '[]'::JSONB,
    'blocked', FALSE
  );
END;
$function$;

-- ADR terminalizado: as mutacoes usam report_id como identidade estavel. As
-- RPCs legadas acima continuam por (viagem, porto) para registros historicos.
CREATE OR REPLACE FUNCTION public.set_agency_report_signoff_by_report_id(
  p_report_id UUID,
  p_voyage_id BIGINT,
  p_port TEXT,
  p_section TEXT,
  p_state TEXT,
  p_justification TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_role TEXT;
  v_owner TEXT;
  v_current TEXT;
  v_report RECORD;
  v_justification TEXT := NULLIF(btrim(COALESCE(p_justification, '')), '');
BEGIN
  SELECT role INTO v_role FROM public.user_profiles WHERE id = auth.uid() AND active = TRUE;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501'; END IF;
  v_role := CASE v_role WHEN 'admin' THEN 'administrativo' WHEN 'operator' THEN 'documentacao' ELSE v_role END;
  v_owner := public.agency_report_section_owner(p_section);
  IF v_owner IS NULL OR p_state NOT IN ('pending', 'confirmed', 'nothing_to_declare') THEN
    RAISE EXCEPTION 'Secao ou estado invalido.' USING ERRCODE = '22023';
  END IF;
  IF v_role NOT IN ('administrativo', v_owner) THEN
    RAISE EXCEPTION 'Secao pertence ao departamento %.', v_owner USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_report FROM public.agency_departure_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND OR v_report.voyage_id <> p_voyage_id OR upper(btrim(v_report.port)) <> upper(btrim(p_port))
     OR v_report.terminal_id IS NULL THEN
    RAISE EXCEPTION 'report_id nao pertence a ADR terminalizado da escala %::%.', p_voyage_id, upper(btrim(p_port)) USING ERRCODE = '23514';
  END IF;
  IF v_report.status = 'closed' THEN RAISE EXCEPTION 'ADR fechado: reabra antes de alterar sign-offs.' USING ERRCODE = '42501'; END IF;

  SELECT state INTO v_current FROM public.agency_departure_report_signoffs
  WHERE report_id = p_report_id AND section = p_section FOR UPDATE;
  v_current := COALESCE(v_current, 'pending');
  IF v_current = p_state THEN RETURN jsonb_build_object('report_id', p_report_id, 'unchanged', TRUE); END IF;
  IF v_current <> 'pending' AND v_justification IS NULL THEN
    RAISE EXCEPTION 'Alterar uma decisao ja registrada exige justificativa.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.agency_departure_report_signoffs
    (report_id, section, state, department, signed_by, signed_at)
  VALUES (p_report_id, p_section, p_state, v_owner, auth.uid(), CASE WHEN p_state = 'pending' THEN NULL ELSE now() END)
  ON CONFLICT (report_id, section) DO UPDATE SET state = EXCLUDED.state, department = EXCLUDED.department,
    signed_by = EXCLUDED.signed_by, signed_at = EXCLUDED.signed_at;
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('agency_departure_report_signoff', p_report_id::TEXT || '::' || p_section, 'state', v_current, p_state, auth.uid(), v_justification);
  RETURN jsonb_build_object('report_id', p_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_agency_report_section_observation_by_report_id(
  p_report_id UUID, p_voyage_id BIGINT, p_port TEXT, p_section TEXT, p_observation TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_role TEXT;
  v_owner TEXT;
  v_report RECORD;
BEGIN
  SELECT role INTO v_role FROM public.user_profiles WHERE id = auth.uid() AND active = TRUE;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501'; END IF;
  v_role := CASE v_role WHEN 'admin' THEN 'administrativo' WHEN 'operator' THEN 'documentacao' ELSE v_role END;
  v_owner := public.agency_report_section_owner(p_section);
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Secao invalida.' USING ERRCODE = '22023'; END IF;
  IF v_role NOT IN ('administrativo', v_owner) THEN RAISE EXCEPTION 'Secao pertence ao departamento %.', v_owner USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_report FROM public.agency_departure_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND OR v_report.voyage_id <> p_voyage_id OR upper(btrim(v_report.port)) <> upper(btrim(p_port))
     OR v_report.terminal_id IS NULL THEN
    RAISE EXCEPTION 'report_id nao pertence a ADR terminalizado da escala %::%.', p_voyage_id, upper(btrim(p_port)) USING ERRCODE = '23514';
  END IF;
  IF v_report.status = 'closed' THEN RAISE EXCEPTION 'ADR fechado: reabra antes de alterar a observacao.' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.agency_departure_report_signoffs (report_id, section, department, observation)
  VALUES (p_report_id, p_section, v_owner, NULLIF(btrim(COALESCE(p_observation, '')), ''))
  ON CONFLICT (report_id, section) DO UPDATE SET observation = EXCLUDED.observation;
  RETURN jsonb_build_object('report_id', p_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_agency_report_department_signoff_by_report_id(
  p_report_id UUID, p_voyage_id BIGINT, p_port TEXT, p_department TEXT, p_signed BOOLEAN, p_justification TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_role TEXT;
  v_report RECORD;
  v_current BOOLEAN;
  v_justification TEXT := NULLIF(btrim(COALESCE(p_justification, '')), '');
BEGIN
  SELECT role INTO v_role FROM public.user_profiles WHERE id = auth.uid() AND active = TRUE;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501'; END IF;
  v_role := CASE v_role WHEN 'admin' THEN 'administrativo' WHEN 'operator' THEN 'documentacao' ELSE v_role END;
  IF p_department NOT IN ('operacoes', 'documentacao', 'equipamentos') THEN RAISE EXCEPTION 'Departamento invalido.' USING ERRCODE = '22023'; END IF;
  IF v_role NOT IN ('administrativo', p_department) THEN RAISE EXCEPTION 'Sign-off pertence ao departamento %.', p_department USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_report FROM public.agency_departure_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND OR v_report.voyage_id <> p_voyage_id OR upper(btrim(v_report.port)) <> upper(btrim(p_port))
     OR v_report.terminal_id IS NULL THEN
    RAISE EXCEPTION 'report_id nao pertence a ADR terminalizado da escala %::%.', p_voyage_id, upper(btrim(p_port)) USING ERRCODE = '23514';
  END IF;
  IF v_report.status = 'closed' THEN RAISE EXCEPTION 'ADR fechado: reabra antes de alterar o sign-off departamental.' USING ERRCODE = '42501'; END IF;
  SELECT signed_at IS NOT NULL INTO v_current FROM public.agency_departure_report_department_signoffs
  WHERE report_id = p_report_id AND department = p_department FOR UPDATE;
  v_current := COALESCE(v_current, FALSE);
  IF v_current = p_signed THEN RETURN jsonb_build_object('report_id', p_report_id, 'unchanged', TRUE); END IF;
  IF NOT p_signed AND v_current AND v_justification IS NULL THEN
    RAISE EXCEPTION 'Reabrir o sign-off departamental exige justificativa.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.agency_departure_report_department_signoffs (report_id, department, signed_by, signed_at)
  VALUES (p_report_id, p_department, auth.uid(), CASE WHEN p_signed THEN now() ELSE NULL END)
  ON CONFLICT (report_id, department) DO UPDATE SET signed_by = EXCLUDED.signed_by, signed_at = EXCLUDED.signed_at;
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('agency_departure_report_department_signoff', p_report_id::TEXT || '::' || p_department, 'signed', v_current::TEXT, p_signed::TEXT, auth.uid(), v_justification);
  IF p_signed THEN
    UPDATE public.alerts
    SET status = 'closed', closed_at = now()
    WHERE type = 'agency_report_department_pending'
      AND entity_type = 'agency_departure_report'
      AND entity_id = public.agency_report_alert_entity_id(
        v_report.voyage_id,
        v_report.port,
        (SELECT d.code FROM public.depots AS d WHERE d.id = v_report.terminal_id),
        p_department
      )
      AND status <> 'closed';
  END IF;
  RETURN jsonb_build_object('report_id', p_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.close_agency_departure_report_by_report_id(
  p_report_id UUID, p_voyage_id BIGINT, p_port TEXT, p_snapshot JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_report RECORD;
  v_signed INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501'; END IF;
  PERFORM public.assert_voyage_escala_ready_for_report_close(p_voyage_id, p_port, p_report_id);
  SELECT * INTO v_report FROM public.agency_departure_reports WHERE id = p_report_id FOR UPDATE;
  IF v_report.voyage_id <> p_voyage_id OR upper(btrim(v_report.port)) <> upper(btrim(p_port)) OR v_report.terminal_id IS NULL THEN
    RAISE EXCEPTION 'report_id nao pertence a ADR terminalizado da escala %::%.', p_voyage_id, upper(btrim(p_port)) USING ERRCODE = '23514';
  END IF;
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' OR jsonb_typeof(p_snapshot->'header') <> 'object'
     OR jsonb_typeof(p_snapshot->'sections') <> 'object' OR jsonb_typeof(p_snapshot->'occurrences') <> 'array'
     OR jsonb_typeof(p_snapshot->'signoffs') <> 'array' OR octet_length(p_snapshot::TEXT) > 8388608 THEN
    RAISE EXCEPTION 'Snapshot invalido.' USING ERRCODE = '22023';
  END IF;
  SELECT COUNT(*) INTO v_signed FROM public.agency_departure_report_department_signoffs
  WHERE report_id = p_report_id AND signed_at IS NOT NULL;
  IF v_signed <> 3 THEN RAISE EXCEPTION 'Fechamento exige os 3 departamentos assinados (% pendentes).', 3 - v_signed USING ERRCODE = '23514'; END IF;
  UPDATE public.agency_departure_reports SET status = 'closed', closed_at = now(), closed_by = auth.uid(), closed_snapshot = p_snapshot
  WHERE id = p_report_id AND status = 'open';
  IF NOT FOUND THEN RAISE EXCEPTION 'ADR ja fechado.' USING ERRCODE = '23505'; END IF;
  UPDATE public.alerts SET status = 'closed', closed_at = now()
  WHERE type IN ('agency_report_section_pending', 'agency_report_department_pending', 'agency_report_deadline_missed')
    AND entity_type = 'agency_departure_report'
    AND entity_id LIKE public.agency_report_alert_entity_prefix(
      v_report.voyage_id,
      v_report.port,
      (SELECT d.code FROM public.depots AS d WHERE d.id = v_report.terminal_id)
    ) || '%'
    AND status <> 'closed';
  RETURN jsonb_build_object('report_id', p_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_agency_departure_report_by_report_id(
  p_report_id UUID, p_voyage_id BIGINT, p_port TEXT, p_justification TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_report RECORD;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501'; END IF;
  IF btrim(COALESCE(p_justification, '')) = '' THEN RAISE EXCEPTION 'Reabertura exige justificativa.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_report FROM public.agency_departure_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND OR v_report.voyage_id <> p_voyage_id OR upper(btrim(v_report.port)) <> upper(btrim(p_port))
     OR v_report.terminal_id IS NULL THEN RAISE EXCEPTION 'report_id nao pertence a ADR terminalizado da escala %::%.', p_voyage_id, upper(btrim(p_port)) USING ERRCODE = '23514'; END IF;
  IF v_report.status <> 'closed' THEN RAISE EXCEPTION 'ADR nao esta fechado.' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.agency_departure_reports SET status = 'open', closed_at = NULL, closed_by = NULL, closed_snapshot = NULL WHERE id = p_report_id;
  -- Reabrir destrava a edição sem apagar decisões, assinaturas ou histórico.
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('agency_departure_report', p_report_id::TEXT, 'status', 'closed', 'open', auth.uid(), btrim(p_justification));
  RETURN jsonb_build_object('report_id', p_report_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_agency_report_signoff_by_report_id(UUID, BIGINT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_agency_report_section_observation_by_report_id(UUID, BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_agency_report_department_signoff_by_report_id(UUID, BIGINT, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_agency_departure_report_by_report_id(UUID, BIGINT, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reopen_agency_departure_report_by_report_id(UUID, BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_agency_report_signoff_by_report_id(UUID, BIGINT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_agency_report_section_observation_by_report_id(UUID, BIGINT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_agency_report_department_signoff_by_report_id(UUID, BIGINT, TEXT, TEXT, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_agency_departure_report_by_report_id(UUID, BIGINT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_agency_departure_report_by_report_id(UUID, BIGINT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.validate_escala_port_reference() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_agency_departure_report_port() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_voyage_escala_terminal_state(BIGINT, TEXT, INTEGER, JSONB, JSONB, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_voyage_escala_terminal_state(BIGINT, TEXT, INTEGER, JSONB, JSONB, JSONB, TEXT) TO authenticated;

-- Alertas de ADR terminalizado usam a mesma identidade do relatório, mas
-- preservam a forma legada para ADRs sem terminal:
--   viagem::porto::secao-ou-departamento
--   viagem::porto::terminal::secao-ou-departamento
-- O terminal é o código cadastrado: é estável para a operação e legível na
-- tela de Alertas. Os relatórios continuam ancorados por report_id nas RPCs.
CREATE OR REPLACE FUNCTION public.agency_report_alert_entity_prefix(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_terminal_code TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT p_voyage_id::TEXT || '::' || upper(btrim(p_port)) ||
    CASE
      WHEN NULLIF(btrim(COALESCE(p_terminal_code, '')), '') IS NULL THEN '::'
      ELSE '::' || btrim(p_terminal_code) || '::'
    END;
$function$;

CREATE OR REPLACE FUNCTION public.agency_report_alert_entity_id(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_terminal_code TEXT,
  p_subject TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT public.agency_report_alert_entity_prefix(p_voyage_id, p_port, p_terminal_code) || p_subject;
$function$;

CREATE OR REPLACE FUNCTION public.close_legacy_agency_report_alerts_for_scale(
  p_voyage_id BIGINT,
  p_port TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_closed INTEGER;
BEGIN
  UPDATE public.alerts AS a
  SET status = 'closed', closed_at = now()
  WHERE a.type IN (
      'agency_report_section_pending',
      'agency_report_department_pending',
      'agency_report_deadline_missed'
    )
    AND a.entity_type = 'agency_departure_report'
    AND array_length(string_to_array(a.entity_id, '::'), 1) = 3
    AND a.entity_id LIKE public.agency_report_alert_entity_prefix(p_voyage_id, p_port, NULL) || '%'
    AND a.status <> 'closed'
    AND EXISTS (
      SELECT 1
      FROM public.agency_departure_reports AS r
      WHERE r.voyage_id = p_voyage_id
        AND r.port = upper(btrim(p_port))
        AND r.terminal_id IS NOT NULL
    );
  GET DIAGNOSTICS v_closed = ROW_COUNT;
  RETURN v_closed;
END;
$function$;

REVOKE ALL ON FUNCTION public.agency_report_alert_entity_prefix(BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agency_report_alert_entity_id(BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.close_legacy_agency_report_alerts_for_scale(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;

-- Reaplica os três detectores depois da criação do modelo terminalizado. O
-- alvo é cada ADR aberto; só escalas sem ADR terminalizado continuam usando o
-- alvo legado por escala. DISTINCT evita fan-out dentro da mesma execução e o
-- advisory lock serializa duas detecções concorrentes.
CREATE OR REPLACE FUNCTION public.detect_agency_report_pending()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  -- O detector público/canônico é o ponto chamado pelo cliente. Mantê-lo
  -- como delegação evita que a implementação terminalizada e a histórica
  -- voltem a divergir em tipos, dedupe e fechamento de alertas.
  RETURN public.detect_agency_report_department_pending();
END;
$function$;

CREATE OR REPLACE FUNCTION public.detect_agency_report_department_pending()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_inserted INTEGER := 0;
  v_scale RECORD;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('agency_report_alert_detection', 0));
  FOR v_scale IN
    SELECT DISTINCT voyage_id, port
    FROM public.agency_departure_reports
    WHERE terminal_id IS NOT NULL
  LOOP
    PERFORM public.close_legacy_agency_report_alerts_for_scale(v_scale.voyage_id, v_scale.port);
  END LOOP;
  WITH latest_atd AS (
    SELECT DISTINCT ON (entity_type, entity_id) entity_type, entity_id, new_value, changed_at
    FROM public.audit_logs WHERE entity_type IN ('voyage_pod_schedule', 'voyage_pol_schedule') AND field_name = 'atd'
    ORDER BY entity_type, entity_id, changed_at DESC
  ), departed AS (
    SELECT DISTINCT split_part(entity_id, '::', 1)::BIGINT AS voyage_id, upper(trim(split_part(entity_id, '::', 2))) AS port
    FROM latest_atd
    WHERE COALESCE(trim(new_value), '') <> '' AND upper(trim(split_part(entity_id, '::', 2))) LIKE 'BR%'
      AND ((entity_type = 'voyage_pod_schedule' AND changed_at >= TIMESTAMPTZ '2026-07-19 00:00:00+00')
        OR (entity_type = 'voyage_pol_schedule' AND changed_at >= (SELECT captured_at FROM public.agency_report_pending_baselines WHERE baseline_key = 'voyage_pol_schedule_atd')))
  ), departments AS (SELECT unnest(ARRAY['operacoes', 'documentacao', 'equipamentos']) AS department),
  report_targets AS (
    SELECT d.voyage_id, d.port, r.id AS report_id, r.status, CASE WHEN r.terminal_id IS NULL THEN NULL ELSE terminal.code END AS terminal_code
    FROM departed AS d
    LEFT JOIN public.agency_departure_reports AS r ON r.voyage_id = d.voyage_id AND r.port = d.port
      AND (r.terminal_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM public.agency_departure_reports AS newer WHERE newer.voyage_id = d.voyage_id AND newer.port = d.port AND newer.terminal_id IS NOT NULL))
    LEFT JOIN public.depots AS terminal ON terminal.id = r.terminal_id
  ), pending AS (
    SELECT DISTINCT t.voyage_id, t.port, t.terminal_code, t.report_id, dep.department
    FROM report_targets AS t CROSS JOIN departments AS dep
    WHERE COALESCE(t.status, 'open') = 'open' AND EXISTS (
      SELECT 1 FROM (VALUES ('datas'), ('carga_descarregada'), ('carga_carregada'), ('veiculos'), ('vazios_embarcados'), ('vazios_descarregados'), ('operacao_patio')) AS all_sections(section)
      LEFT JOIN public.agency_departure_report_signoffs AS so ON so.report_id = t.report_id AND so.section = all_sections.section
      WHERE public.agency_report_section_owner(all_sections.section) = dep.department AND COALESCE(so.state, 'pending') = 'pending'
    )
  ), inserted AS (
    INSERT INTO public.alerts (type, entity_type, entity_id, message, status)
    SELECT 'agency_report_department_pending', 'agency_departure_report',
      public.agency_report_alert_entity_id(p.voyage_id, p.port, p.terminal_code, p.department),
      'ADR ' || p.port || CASE WHEN p.terminal_code IS NULL THEN '' ELSE ' / ' || p.terminal_code END || ': departamento "' || public.agency_report_department_label(p.department) || '" pendente.', 'open'
    FROM pending AS p
    WHERE NOT EXISTS (SELECT 1 FROM public.alerts AS a WHERE a.type = 'agency_report_department_pending' AND a.entity_type = 'agency_departure_report' AND a.entity_id = public.agency_report_alert_entity_id(p.voyage_id, p.port, p.terminal_code, p.department) AND a.status <> 'closed')
    RETURNING 1
  ) SELECT COUNT(*) INTO v_inserted FROM inserted;
  RETURN v_inserted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.detect_agency_report_deadline_missed()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_inserted INTEGER := 0;
  v_scale RECORD;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('agency_report_alert_detection', 0));
  FOR v_scale IN
    SELECT DISTINCT voyage_id, port
    FROM public.agency_departure_reports
    WHERE terminal_id IS NOT NULL
  LOOP
    PERFORM public.close_legacy_agency_report_alerts_for_scale(v_scale.voyage_id, v_scale.port);
  END LOOP;
  WITH latest_atd AS (
    SELECT DISTINCT ON (entity_type, entity_id) entity_type, entity_id, new_value, changed_at
    FROM public.audit_logs WHERE entity_type IN ('voyage_pod_schedule', 'voyage_pol_schedule') AND field_name = 'atd'
    ORDER BY entity_type, entity_id, changed_at DESC
  ), latest_omitted AS (
    SELECT DISTINCT ON (entity_id) entity_id, new_value FROM public.audit_logs WHERE entity_type = 'voyage_pod_schedule' AND field_name = 'omitted' ORDER BY entity_id, changed_at DESC
  ), pod_atd AS (
    SELECT entity_id, split_part(entity_id, '::', 1)::BIGINT AS voyage_id, upper(trim(split_part(entity_id, '::', 2))) AS port, NULLIF(trim(new_value), '')::DATE AS atd
    FROM latest_atd WHERE entity_type = 'voyage_pod_schedule' AND COALESCE(trim(new_value), '') <> ''
  ), pol_atd AS (
    SELECT split_part(entity_id, '::', 1)::BIGINT AS voyage_id, upper(trim(split_part(entity_id, '::', 2))) AS port, NULLIF(trim(new_value), '')::DATE AS atd
    FROM latest_atd WHERE entity_type = 'voyage_pol_schedule' AND COALESCE(trim(new_value), '') <> ''
  ), escalas AS (
    SELECT voyage_id, port FROM pod_atd UNION SELECT voyage_id, port FROM pol_atd
  ), unified AS (
    SELECT e.voyage_id, e.port, COALESCE(p.atd, l.atd) AS atd,
      EXISTS (SELECT 1 FROM latest_omitted AS o WHERE o.entity_id = e.voyage_id || '::' || e.port AND o.new_value = 'true') AS omitted
    FROM escalas AS e LEFT JOIN pod_atd AS p ON p.voyage_id = e.voyage_id AND p.port = e.port LEFT JOIN pol_atd AS l ON l.voyage_id = e.voyage_id AND l.port = e.port
    WHERE e.port LIKE 'BR%'
  ), measured AS (
    SELECT voyage_id, port, public.agency_report_deadline_date(atd) AS deadline_date
    FROM unified WHERE atd IS NOT NULL AND NOT omitted AND atd >= (SELECT captured_at::DATE FROM public.agency_report_pending_baselines WHERE baseline_key = 'agency_report_deadline_missed')
  ), departments AS (SELECT unnest(ARRAY['operacoes', 'documentacao', 'equipamentos']) AS department),
  report_targets AS (
    SELECT m.voyage_id, m.port, r.id AS report_id, r.status, CASE WHEN r.terminal_id IS NULL THEN NULL ELSE terminal.code END AS terminal_code, m.deadline_date
    FROM measured AS m
    LEFT JOIN public.agency_departure_reports AS r ON r.voyage_id = m.voyage_id AND r.port = m.port
      AND (r.terminal_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM public.agency_departure_reports AS newer WHERE newer.voyage_id = m.voyage_id AND newer.port = m.port AND newer.terminal_id IS NOT NULL))
    LEFT JOIN public.depots AS terminal ON terminal.id = r.terminal_id
  ), missed AS (
    SELECT DISTINCT t.voyage_id, t.port, t.terminal_code, t.report_id, dep.department
    FROM report_targets AS t CROSS JOIN departments AS dep
    LEFT JOIN public.agency_departure_report_department_signoffs AS ds ON ds.report_id = t.report_id AND ds.department = dep.department
    WHERE t.deadline_date < CURRENT_DATE AND COALESCE(t.status, 'open') = 'open' AND ds.signed_at IS NULL
  ), inserted AS (
    INSERT INTO public.alerts (type, entity_type, entity_id, message, status)
    SELECT 'agency_report_deadline_missed', 'agency_departure_report',
      public.agency_report_alert_entity_id(x.voyage_id, x.port, x.terminal_code, x.department),
      'ADR ' || x.port || CASE WHEN x.terminal_code IS NULL THEN '' ELSE ' / ' || x.terminal_code END || ': prazo de conclusão vencido para "' || public.agency_report_department_label(x.department) || '".', 'open'
    FROM missed AS x
    WHERE NOT EXISTS (SELECT 1 FROM public.alerts AS a WHERE a.type = 'agency_report_deadline_missed' AND a.entity_type = 'agency_departure_report' AND a.entity_id = public.agency_report_alert_entity_id(x.voyage_id, x.port, x.terminal_code, x.department) AND a.status <> 'closed')
    RETURNING 1
  ) SELECT COUNT(*) INTO v_inserted FROM inserted;
  RETURN v_inserted;
END;
$function$;

-- A identidade por (viagem, porto) continua válida somente para o ADR legado.
-- Depois da terminalização, resolvers e reabertura precisam evitar SELECT INTO
-- arbitrário entre vários ADRs da mesma escala.
CREATE OR REPLACE FUNCTION public.get_agency_report_actor_names(
  p_voyage_id BIGINT, p_port TEXT
)
RETURNS TABLE (user_id UUID, full_name TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_report_id UUID;
  v_prefix TEXT := p_voyage_id || '::' || upper(btrim(p_port)) || '::';
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_report_id
  FROM public.agency_departure_reports
  WHERE voyage_id = p_voyage_id
    AND port = upper(btrim(p_port))
    AND terminal_id IS NULL;
  IF v_report_id IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT up.id, up.full_name FROM public.user_profiles AS up
  WHERE up.id IN (
    SELECT r.closed_by FROM public.agency_departure_reports AS r WHERE r.id = v_report_id AND r.closed_by IS NOT NULL
    UNION SELECT so.signed_by FROM public.agency_departure_report_signoffs AS so WHERE so.report_id = v_report_id AND so.signed_by IS NOT NULL
    UNION SELECT dso.signed_by FROM public.agency_departure_report_department_signoffs AS dso WHERE dso.report_id = v_report_id AND dso.signed_by IS NOT NULL
    UNION SELECT oc.author_id FROM public.agency_departure_report_occurrences AS oc WHERE oc.report_id = v_report_id
    UNION SELECT al.changed_by FROM public.audit_logs AS al
      WHERE al.entity_type IN ('agency_departure_report_signoff', 'agency_departure_report_department_signoff')
        AND al.entity_id LIKE v_prefix || '%' AND al.changed_by IS NOT NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_agency_report_actor_names_by_report_id(
  p_report_id UUID
)
RETURNS TABLE (user_id UUID, full_name TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT up.id, up.full_name FROM public.user_profiles AS up
  WHERE up.id IN (
    SELECT r.closed_by FROM public.agency_departure_reports AS r WHERE r.id = p_report_id AND r.closed_by IS NOT NULL
    UNION SELECT so.signed_by FROM public.agency_departure_report_signoffs AS so WHERE so.report_id = p_report_id AND so.signed_by IS NOT NULL
    UNION SELECT dso.signed_by FROM public.agency_departure_report_department_signoffs AS dso WHERE dso.report_id = p_report_id AND dso.signed_by IS NOT NULL
    UNION SELECT oc.author_id FROM public.agency_departure_report_occurrences AS oc WHERE oc.report_id = p_report_id
    UNION SELECT al.changed_by FROM public.audit_logs AS al
      WHERE al.entity_type IN ('agency_departure_report_signoff', 'agency_departure_report_department_signoff')
        AND al.entity_id LIKE p_report_id::TEXT || '::%' AND al.changed_by IS NOT NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_agency_departure_report(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_justification TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_report_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  IF btrim(COALESCE(p_justification, '')) = '' THEN
    RAISE EXCEPTION 'Reabertura exige justificativa.' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_report_id
  FROM public.agency_departure_reports
  WHERE voyage_id = p_voyage_id
    AND port = upper(btrim(p_port))
    AND status = 'closed'
    AND terminal_id IS NULL
  FOR UPDATE;
  IF v_report_id IS NULL THEN
    RAISE EXCEPTION 'ADR nao esta fechado.' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.agency_departure_reports
  SET status = 'open', closed_at = NULL, closed_by = NULL, closed_snapshot = NULL
  WHERE id = v_report_id;
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('agency_departure_report', p_voyage_id || '::' || upper(btrim(p_port)),
          'status', 'closed', 'open', auth.uid(), btrim(p_justification));
  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.detect_agency_report_pending() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.detect_agency_report_department_pending() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.detect_agency_report_deadline_missed() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_agency_report_actor_names_by_report_id(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detect_agency_report_pending() TO authenticated;
GRANT EXECUTE ON FUNCTION public.detect_agency_report_department_pending() TO authenticated;
GRANT EXECUTE ON FUNCTION public.detect_agency_report_deadline_missed() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_agency_report_actor_names_by_report_id(UUID) TO authenticated;
