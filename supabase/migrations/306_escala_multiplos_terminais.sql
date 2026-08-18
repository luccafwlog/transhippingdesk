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

-- O código é normalizado no banco para que escrita direta do Cadastro não
-- reintroduza diferenças de caixa ou espaços.
ALTER TABLE public.depots
  ADD COLUMN IF NOT EXISTS port_id BIGINT REFERENCES public.ports(id) ON DELETE RESTRICT;

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
  ADD CONSTRAINT depots_tipo_port_check
    CHECK (
      (tipo = 'terminal_portuario' AND port_id IS NOT NULL)
      OR (tipo = 'depot' AND port_id IS NULL)
    ),
  DROP CONSTRAINT IF EXISTS depots_id_port_id_key,
  ADD CONSTRAINT depots_id_port_id_key UNIQUE (id, port_id);

CREATE INDEX IF NOT EXISTS idx_depots_port_id_active
  ON public.depots (port_id, active);

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

REVOKE ALL ON FUNCTION public.normalize_depot_code() FROM PUBLIC, anon;

-- A FK composta torna impossível apontar uma frente para um depot comum ou
-- para um terminal portuário cadastrado em outro porto.
CREATE TABLE IF NOT EXISTS public.voyage_escala_terminal_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voyage_id BIGINT NOT NULL REFERENCES public.voyages(id) ON DELETE CASCADE,
  port TEXT NOT NULL CHECK (port = upper(btrim(port)) AND btrim(port) <> ''),
  port_id BIGINT NOT NULL REFERENCES public.ports(id) ON DELETE RESTRICT,
  terminal_id UUID NOT NULL REFERENCES public.depots(id) ON DELETE RESTRICT,
  terminal_atb TIMESTAMPTZ,
  terminal_atd TIMESTAMPTZ,
  terminal_rtw TIMESTAMPTZ,
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
  terminal_id UUID REFERENCES public.depots(id) ON DELETE RESTRICT,
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
ALTER TABLE public.agency_departure_reports
  ADD COLUMN IF NOT EXISTS terminal_id UUID,
  ADD COLUMN IF NOT EXISTS terminal_port_id BIGINT;

ALTER TABLE public.agency_departure_reports
  DROP CONSTRAINT IF EXISTS agency_departure_reports_voyage_id_port_key,
  DROP CONSTRAINT IF EXISTS agency_departure_reports_terminal_id_fkey,
  DROP CONSTRAINT IF EXISTS agency_departure_reports_terminal_port_fk,
  DROP CONSTRAINT IF EXISTS agency_departure_reports_terminal_pair_check;

ALTER TABLE public.agency_departure_reports
  ADD CONSTRAINT agency_departure_reports_terminal_id_fkey
    FOREIGN KEY (terminal_id) REFERENCES public.depots(id) ON DELETE RESTRICT,
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
  v_export_granite BOOLEAN := FALSE;
  v_export_empty BOOLEAN := FALSE;
  v_export_declared BOOLEAN := FALSE;
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
BEGIN
  SELECT up.role INTO v_role
  FROM public.user_profiles AS up
  WHERE up.id = auth.uid() AND up.active = TRUE;

  IF auth.uid() IS NULL OR v_role IS NULL
     OR v_role NOT IN ('admin', 'administrativo', 'operacoes') THEN
    RAISE EXCEPTION 'Somente Operações/Admin podem editar terminais da escala.'
      USING ERRCODE = '42501';
  END IF;
  v_department := CASE WHEN v_role IN ('admin', 'administrativo') THEN 'administrativo' ELSE 'operacoes' END;
  v_entity_id := p_voyage_id::TEXT || '::' || v_port;

  IF p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'Revision esperada obrigatoria.' USING ERRCODE = '22023';
  END IF;
  IF p_fronts IS NULL OR jsonb_typeof(p_fronts) <> 'array'
     OR p_terminals IS NULL OR jsonb_typeof(p_terminals) <> 'array'
     OR (p_export_expectation IS NOT NULL AND jsonb_typeof(p_export_expectation) <> 'object') THEN
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
    FROM jsonb_to_recordset(p_terminals) AS t(terminal_id UUID, terminal_atb TIMESTAMPTZ, terminal_atd TIMESTAMPTZ, terminal_rtw TIMESTAMPTZ)
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
          terminal_id UUID, terminal_atb TIMESTAMPTZ, terminal_atd TIMESTAMPTZ, terminal_rtw TIMESTAMPTZ
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
      terminal_rtw TIMESTAMPTZ
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

  SELECT COALESCE(ves.tem_exportacao, FALSE), COALESCE(ves.has_granite, FALSE)
  INTO v_old_export_declared, v_old_export_granite
  FROM public.voyage_export_schedules AS ves
  WHERE ves.voyage_id = p_voyage_id AND ves.pol = v_port
  FOR UPDATE;
  v_old_export_exists := FOUND;
  SELECT EXISTS (
    SELECT 1 FROM public.voyage_escala_operation_fronts AS f
    WHERE f.voyage_id = p_voyage_id AND f.port = v_port
      AND f.sentido = 'exportacao' AND f.modalidade = 'vazio'
  ) INTO v_old_export_empty;

  IF COALESCE(p_export_expectation, '{}'::JSONB) ? 'granito' THEN
    v_export_granite := COALESCE((p_export_expectation->>'granito')::BOOLEAN, FALSE);
  ELSE
    v_export_granite := EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
      WHERE lower(btrim(f.sentido)) = 'exportacao' AND lower(btrim(f.modalidade)) = 'granito'
    );
  END IF;
  IF COALESCE(p_export_expectation, '{}'::JSONB) ? 'vazios' THEN
    v_export_empty := COALESCE((p_export_expectation->>'vazios')::BOOLEAN, FALSE);
  ELSE
    v_export_empty := EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
      WHERE lower(btrim(f.sentido)) = 'exportacao' AND lower(btrim(f.modalidade)) = 'vazio'
    );
  END IF;
  v_export_declared := v_export_granite OR v_export_empty;

  IF COALESCE(p_export_expectation, '{}'::JSONB) ? 'tem_exportacao' THEN
    IF COALESCE((p_export_expectation->>'tem_exportacao')::BOOLEAN, FALSE) IS DISTINCT FROM v_export_declared THEN
      RAISE EXCEPTION 'Expectativa de exportacao diverge das frentes declaradas.' USING ERRCODE = '23514';
    END IF;
  END IF;
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
    'vazios', v_old_export_empty
  );
  v_export_new := jsonb_build_object(
    'tem_exportacao', v_export_declared,
    'granito', v_export_granite,
    'vazios', v_export_empty
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
      terminal_id UUID, terminal_atb TIMESTAMPTZ, terminal_atd TIMESTAMPTZ, terminal_rtw TIMESTAMPTZ
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

  UPDATE public.voyage_escala_revision_state
  SET revision = v_next_revision, updated_at = now()
  WHERE voyage_id = p_voyage_id AND port = v_port;

  UPDATE public.voyage_escala_terminal_state
  SET revision = v_next_revision, updated_at = now()
  WHERE voyage_id = p_voyage_id AND port = v_port;

  FOR v_terminal IN
    SELECT t.terminal_id, t.terminal_atb, t.terminal_atd, t.terminal_rtw
    FROM jsonb_to_recordset(p_terminals) AS t(
      terminal_id UUID, terminal_atb TIMESTAMPTZ, terminal_atd TIMESTAMPTZ, terminal_rtw TIMESTAMPTZ
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
          v_old_front.terminal_id::TEXT, v_front.terminal_id::TEXT,
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
      voyage_id, pol, tem_exportacao, has_granite, updated_at
    )
    VALUES (p_voyage_id, v_port, v_export_declared, v_export_granite, now())
    ON CONFLICT (voyage_id, pol) DO UPDATE SET
      tem_exportacao = EXCLUDED.tem_exportacao,
      has_granite = EXCLUDED.has_granite,
      updated_at = now();
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
      -- Um ADR aberto só pode ser removido quando não há filhos nem histórico
      -- associado. A guarda evita que o ON DELETE CASCADE apague sign-offs,
      -- ocorrências ou evidência auditável da operação.
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
           OR al.old_value ILIKE '%' || v_report.id::TEXT || '%'
           OR al.new_value ILIKE '%' || v_report.id::TEXT || '%'
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
    'closed_blockers', '[]'::JSONB
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_escala_port_reference() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.validate_agency_departure_report_port() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_voyage_escala_terminal_state(BIGINT, TEXT, INTEGER, JSONB, JSONB, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_voyage_escala_terminal_state(BIGINT, TEXT, INTEGER, JSONB, JSONB, JSONB, TEXT) TO authenticated;
