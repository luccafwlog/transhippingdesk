-- 345: recupera datas de berco e Atracacao TBC por escala quando a migration 341 foi pulada.
-- A sequencia nao e persistida: COALESCE(terminal_atb, terminal_etb),
-- desempatado pelo codigo do terminal, e a projecao compartilhada no cliente.

ALTER TABLE public.voyage_escala_terminal_state
  ADD COLUMN IF NOT EXISTS terminal_etb TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terminal_etd TIMESTAMPTZ;

-- MATCH SIMPLE na FK composta faz uma Atracacao TBC sem terminal_id deixar de
-- validar a parte terminal->porto; quando o terminal existe, a mesma FK segue
-- impedindo terminal de outro porto.
ALTER TABLE public.voyage_escala_terminal_state
  ALTER COLUMN terminal_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS voyage_escala_terminal_state_terminal_atd_check,
  DROP CONSTRAINT IF EXISTS voyage_escala_terminal_state_terminal_etd_check,
  ADD CONSTRAINT voyage_escala_terminal_state_terminal_atd_check
    CHECK (terminal_atd IS NULL OR (terminal_atb IS NOT NULL AND terminal_atd >= terminal_atb)),
  ADD CONSTRAINT voyage_escala_terminal_state_terminal_etd_check
    CHECK (terminal_etd IS NULL OR (terminal_etb IS NOT NULL AND terminal_etd >= terminal_etb));

CREATE UNIQUE INDEX IF NOT EXISTS uq_voyage_escala_terminal_state_tbc
  ON public.voyage_escala_terminal_state (voyage_id, port)
  WHERE terminal_id IS NULL;

COMMENT ON COLUMN public.voyage_escala_terminal_state.terminal_etb IS
  'ETB previsto da Atracacao; NULL quando ainda nao informado.';
COMMENT ON COLUMN public.voyage_escala_terminal_state.terminal_etd IS
  'ETD previsto da Atracacao; NULL quando ainda nao informado.';
COMMENT ON INDEX public.uq_voyage_escala_terminal_state_tbc IS
  'Uma unica Atracacao TBC por escala; UNIQUE comum nao restringe NULL.';

-- O RPC legado usa NOT EXISTS com igualdade simples. O patch mantém a linha
-- TBC (terminal_id NULL) fora do conjunto de remoção e das validações de
-- alteração de terminal.
DO $patch_legacy_tbc$
DECLARE
  v_definition TEXT;
BEGIN
  SELECT pg_get_functiondef('public.save_voyage_escala_terminal_state(bigint,text,integer,jsonb,jsonb,jsonb,text)'::regprocedure)
    INTO v_definition;
  v_definition := regexp_replace(v_definition,
    '(FROM public\.voyage_escala_terminal_state AS old_t\s+WHERE old_t\.voyage_id = p_voyage_id AND old_t\.port = v_port\s+)AND NOT EXISTS',
    '\1AND old_t.terminal_id IS NOT NULL AND NOT EXISTS', 'g');
  v_definition := regexp_replace(v_definition,
    '(FROM public\.voyage_escala_terminal_state AS s\s+WHERE s\.voyage_id = p_voyage_id AND s\.port = v_port\s+)AND NOT EXISTS',
    '\1AND s.terminal_id IS NOT NULL AND NOT EXISTS', 'g');
  EXECUTE v_definition;
END;
$patch_legacy_tbc$;

-- A RPC de 306 continua sendo preservada para clientes antigos. O fluxo novo
-- delega a ela as regras de frente, exportacao, revisao e ADR fechado, e
-- completa no mesmo contexto transacional as colunas da Atracacao e o TBC.
CREATE OR REPLACE FUNCTION public.save_voyage_escala_terminal_state_v2(
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
  v_legacy JSONB;
  v_non_tbc JSONB;
  v_port TEXT := upper(btrim(COALESCE(p_port, '')));
  v_port_id BIGINT;
  v_revision INTEGER;
  v_terminal JSONB;
  v_terminal_id UUID;
BEGIN
  IF p_terminals IS NULL OR jsonb_typeof(p_terminals) <> 'array' THEN
    RAISE EXCEPTION 'Payload de Atracacoes invalido.' USING ERRCODE = '22023';
  END IF;

  SELECT p.id INTO v_port_id
  FROM public.ports AS p
  WHERE upper(btrim(p.locode)) = v_port
  LIMIT 1;
  IF v_port_id IS NULL THEN
    INSERT INTO public.ports (name, locode, country)
    VALUES (v_port, v_port, 'Brasil')
    RETURNING id INTO v_port_id;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'terminal_id', item->>'terminal_id',
    'terminal_atb', item->>'terminal_atb',
    'terminal_atd', item->>'terminal_atd',
    'terminal_rtw', item->>'terminal_rtw'
  )), '[]'::JSONB)
  INTO v_non_tbc
  FROM jsonb_array_elements(p_terminals) AS entries(item)
  WHERE NULLIF(entries.item->>'terminal_id', '') IS NOT NULL;

  -- O RPC legado não pode interpretar NULL com igualdade simples: uma linha
  -- TBC não deve ser considerada removida nem bloquear uma edição que só
  -- altera a expectativa de exportação. O patch abaixo mantém essa regra no
  -- corpo legado, sem duplicar sua implementação nesta migration.
  v_legacy := public.save_voyage_escala_terminal_state(
    p_voyage_id,
    v_port,
    p_expected_revision,
    p_fronts,
    v_non_tbc,
    p_export_expectation,
    p_justification
  );

  IF COALESCE((v_legacy->>'blocked')::BOOLEAN, FALSE) THEN
    RETURN v_legacy;
  END IF;

  SELECT rs.revision INTO v_revision
  FROM public.voyage_escala_revision_state AS rs
  WHERE rs.voyage_id = p_voyage_id AND rs.port = v_port;

  FOR v_terminal IN SELECT value FROM jsonb_array_elements(p_terminals)
  LOOP
    v_terminal_id := NULLIF(v_terminal->>'terminal_id', '')::UUID;
    IF v_terminal_id IS NULL THEN
      INSERT INTO public.voyage_escala_terminal_state (
        voyage_id, port, port_id, terminal_id, terminal_etb, terminal_atb,
        terminal_etd, terminal_atd, terminal_rtw, revision
      ) VALUES (
        p_voyage_id, v_port, v_port_id, NULL,
        NULLIF(v_terminal->>'terminal_etb', '')::TIMESTAMPTZ,
        NULLIF(v_terminal->>'terminal_atb', '')::TIMESTAMPTZ,
        NULLIF(v_terminal->>'terminal_etd', '')::TIMESTAMPTZ,
        NULLIF(v_terminal->>'terminal_atd', '')::TIMESTAMPTZ,
        NULLIF(v_terminal->>'terminal_rtw', '')::INTEGER,
        COALESCE(v_revision, 0)
      )
      ON CONFLICT (voyage_id, port) WHERE terminal_id IS NULL DO UPDATE SET
        terminal_etb = EXCLUDED.terminal_etb,
        terminal_atb = EXCLUDED.terminal_atb,
        terminal_etd = EXCLUDED.terminal_etd,
        terminal_atd = EXCLUDED.terminal_atd,
        terminal_rtw = EXCLUDED.terminal_rtw,
        revision = EXCLUDED.revision,
        updated_at = now();
    ELSE
      UPDATE public.voyage_escala_terminal_state
      SET terminal_etb = NULLIF(v_terminal->>'terminal_etb', '')::TIMESTAMPTZ,
          terminal_etd = NULLIF(v_terminal->>'terminal_etd', '')::TIMESTAMPTZ,
          revision = COALESCE(v_revision, revision),
          updated_at = now()
      WHERE voyage_id = p_voyage_id AND port = v_port AND terminal_id = v_terminal_id;
    END IF;
  END LOOP;

  -- O status da viagem deixa de depender do atd documental do POD. A função
  -- é criada na migration de alertas seguinte e existe antes de qualquer
  -- chamada operacional desta RPC.
  PERFORM public.refresh_voyage_status_from_terminal_scales(p_voyage_id);

  RETURN jsonb_set(
    v_legacy,
    '{terminals}',
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'terminal_id', s.terminal_id,
        'terminal_etb', s.terminal_etb,
        'terminal_atb', s.terminal_atb,
        'terminal_etd', s.terminal_etd,
        'terminal_atd', s.terminal_atd,
        'terminal_rtw', s.terminal_rtw
      ) ORDER BY s.terminal_atb NULLS LAST, s.terminal_etb NULLS LAST, s.terminal_id NULLS LAST)
      FROM public.voyage_escala_terminal_state AS s
      WHERE s.voyage_id = p_voyage_id AND s.port = v_port
    ), '[]'::JSONB),
    TRUE
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_voyage_escala_terminal_state_v2(BIGINT, TEXT, INTEGER, JSONB, JSONB, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_voyage_escala_terminal_state_v2(BIGINT, TEXT, INTEGER, JSONB, JSONB, JSONB, TEXT) TO authenticated;
