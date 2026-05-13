-- Migration 046: Snapshot de datas POD/POL em voyages via trigger.
--
-- Contexto: datas de ETA, ETB, ATA, ATD, RTW, ETD, CE Status e Linked são
-- armazenadas como eventos insert-only em audit_logs (entity_type =
-- 'voyage_pod_schedule' ou 'voyage_pol_schedule'). A leitura reconstruía o
-- estado atual tomando o valor mais recente por campo — O(n) em audit_logs.
--
-- Esta migration:
-- 1. Adiciona colunas de snapshot em voyages (por POD e por POL).
-- 2. Cria trigger que atualiza o snapshot sempre que um evento de schedule
--    é inserido em audit_logs.
--
-- O histórico completo continua em audit_logs (imutável).
-- As queries de leitura podem agora usar as colunas de snapshot diretamente.

------------------------------------------------------------------------
-- 1. Colunas de snapshot POD (uma linha por voyage; o campo entity_id
--    nos audit_logs é "{voyage_id}::{pod}". Armazenamos o agregado
--    de todos os PODs como JSONB indexado.)
------------------------------------------------------------------------

ALTER TABLE public.voyages
  ADD COLUMN IF NOT EXISTS pod_schedule_snapshot JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pol_schedule_snapshot JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.voyages.pod_schedule_snapshot IS
  'Snapshot do estado atual das datas por POD. Chave = pod, valor = {eta, etb, ata, atd, rtw, ces, linked}.';

COMMENT ON COLUMN public.voyages.pol_schedule_snapshot IS
  'Snapshot do estado atual do ETD por POL. Chave = pol, valor = {etd}.';

------------------------------------------------------------------------
-- 2. Função de trigger
------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_voyage_schedule_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_voyage_id  TEXT;
  v_sub_key    TEXT;
  v_parts      TEXT[];
BEGIN
  -- entity_id format: "{voyage_id}::{pod_or_pol}"
  v_parts     := string_to_array(NEW.entity_id, '::');
  v_voyage_id := v_parts[1];
  v_sub_key   := COALESCE(v_parts[2], '');

  IF v_voyage_id IS NULL OR v_voyage_id = '' THEN
    RETURN NEW;
  END IF;

  IF NEW.entity_type = 'voyage_pod_schedule' THEN
    UPDATE public.voyages
    SET pod_schedule_snapshot = jsonb_set(
      COALESCE(pod_schedule_snapshot, '{}'),
      ARRAY[v_sub_key, NEW.field_name],
      to_jsonb(NEW.new_value),
      true
    )
    WHERE id::TEXT = v_voyage_id;

  ELSIF NEW.entity_type = 'voyage_pol_schedule' THEN
    UPDATE public.voyages
    SET pol_schedule_snapshot = jsonb_set(
      COALESCE(pol_schedule_snapshot, '{}'),
      ARRAY[v_sub_key, NEW.field_name],
      to_jsonb(NEW.new_value),
      true
    )
    WHERE id::TEXT = v_voyage_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_voyage_schedule_snapshot ON public.audit_logs;
CREATE TRIGGER trg_voyage_schedule_snapshot
AFTER INSERT ON public.audit_logs
FOR EACH ROW
WHEN (NEW.entity_type IN ('voyage_pod_schedule', 'voyage_pol_schedule'))
EXECUTE FUNCTION public.trg_voyage_schedule_snapshot();

------------------------------------------------------------------------
-- 3. Backfill: reconstruir snapshots a partir do histórico existente
--    (executa apenas uma vez na migration; safe em produção pois é
--     uma leitura de audit_logs + update de voyages)
------------------------------------------------------------------------

DO $$
DECLARE
  v_row RECORD;
  v_voyage_id TEXT;
  v_sub_key   TEXT;
  v_parts     TEXT[];
BEGIN
  FOR v_row IN
    SELECT DISTINCT ON (entity_id, field_name) entity_id, entity_type, field_name, new_value
    FROM public.audit_logs
    WHERE entity_type IN ('voyage_pod_schedule', 'voyage_pol_schedule')
    ORDER BY entity_id, field_name, changed_at DESC
  LOOP
    v_parts     := string_to_array(v_row.entity_id, '::');
    v_voyage_id := v_parts[1];
    v_sub_key   := COALESCE(v_parts[2], '');

    IF v_voyage_id IS NULL OR v_voyage_id = '' THEN
      CONTINUE;
    END IF;

    IF v_row.entity_type = 'voyage_pod_schedule' THEN
      UPDATE public.voyages
      SET pod_schedule_snapshot = jsonb_set(
        COALESCE(pod_schedule_snapshot, '{}'),
        ARRAY[v_sub_key, v_row.field_name],
        to_jsonb(v_row.new_value),
        true
      )
      WHERE id::TEXT = v_voyage_id;

    ELSIF v_row.entity_type = 'voyage_pol_schedule' THEN
      UPDATE public.voyages
      SET pol_schedule_snapshot = jsonb_set(
        COALESCE(pol_schedule_snapshot, '{}'),
        ARRAY[v_sub_key, v_row.field_name],
        to_jsonb(v_row.new_value),
        true
      )
      WHERE id::TEXT = v_voyage_id;
    END IF;
  END LOOP;
END;
$$;
