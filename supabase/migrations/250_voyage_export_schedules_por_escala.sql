-- Intent: promover voyage_export_schedules de uma linha por viagem para uma
-- linha por (viagem, POL), preservando residuos sem porto para revisao manual.
-- Affected objects: public.voyage_export_schedules.
-- Consumers prepared in Task 1: src/services/voyageExportSchedules.ts,
-- src/hooks/useViagemSchedulesAndStats.ts, src/pages/Viagens.tsx,
-- src/components/voyages/VoyageVisaoTab.tsx e src/services/lineup.ts.
-- Rollback: restaurar a constraint UNIQUE (voyage_id) e reverter o consumidor
-- para linha unica por viagem.

DO $$
DECLARE
  v_remaining_null_pol_count INTEGER := 0;
BEGIN
  WITH target_rows AS (
    SELECT id, voyage_id
    FROM public.voyage_export_schedules
    WHERE pol IS NULL
  ),
  pol_schedule_source AS (
    SELECT
      source.voyage_id,
      COUNT(*) AS current_br_pol_count,
      CASE
        WHEN COUNT(*) = 1 THEN MIN(source.normalized_pol)
        ELSE NULL
      END AS normalized_pol
    FROM (
      SELECT
        tr.voyage_id,
        CASE
          WHEN substring(UPPER(TRIM(snapshot_entry.key)) FROM '\m((?:BR|CN)[A-Z0-9]{3})\M') IS NOT NULL
            THEN REPLACE(substring(UPPER(TRIM(snapshot_entry.key)) FROM '\m((?:BR|CN)[A-Z0-9]{3})\M'), 'BRVIT', 'BRVIX')
          WHEN public.normalize_port_code(snapshot_entry.key) = 'BRVIT' THEN 'BRVIX'
          WHEN public.normalize_port_code(snapshot_entry.key) IN ('BRSSA', 'CNTAO', 'CNSHA', 'CNTAC', 'CNNGB', 'CNNSA', 'CNZJG')
            THEN public.normalize_port_code(snapshot_entry.key)
          WHEN UPPER(TRIM(snapshot_entry.key)) LIKE '%PECEM%' THEN 'BRPEC'
          WHEN UPPER(TRIM(snapshot_entry.key)) ~ '^[A-Z]{5}$' THEN UPPER(TRIM(snapshot_entry.key))
          ELSE NULL
        END AS normalized_pol
      FROM target_rows tr
      INNER JOIN public.voyages v
        ON v.id = tr.voyage_id
      CROSS JOIN LATERAL jsonb_each(COALESCE(v.pol_schedule_snapshot, '{}'::JSONB)) AS snapshot_entry(key, value)
    ) AS source
    WHERE source.normalized_pol LIKE 'BR%'
    GROUP BY source.voyage_id
  ),
  granite_source AS (
    SELECT
      gm.voyage_id,
      MAX(
        CASE
          WHEN substring(UPPER(TRIM(gm.loading_port)) FROM '\m((?:BR|CN)[A-Z0-9]{3})\M') IS NOT NULL
            THEN REPLACE(substring(UPPER(TRIM(gm.loading_port)) FROM '\m((?:BR|CN)[A-Z0-9]{3})\M'), 'BRVIT', 'BRVIX')
          WHEN public.normalize_port_code(gm.loading_port) = 'BRVIT' THEN 'BRVIX'
          WHEN public.normalize_port_code(gm.loading_port) IN ('BRSSA', 'CNTAO', 'CNSHA', 'CNTAC', 'CNNGB', 'CNNSA', 'CNZJG')
            THEN public.normalize_port_code(gm.loading_port)
          WHEN UPPER(TRIM(gm.loading_port)) LIKE '%PECEM%' THEN 'BRPEC'
          WHEN UPPER(TRIM(gm.loading_port)) ~ '^[A-Z]{5}$' THEN UPPER(TRIM(gm.loading_port))
          ELSE NULL
        END
      ) AS normalized_pol
    FROM public.granite_manifests gm
    INNER JOIN target_rows tr
      ON tr.voyage_id = gm.voyage_id
    WHERE gm.loading_port IS NOT NULL
    GROUP BY gm.voyage_id
  ),
  vazios_source AS (
    SELECT
      veo.voyage_id,
      MAX(
        CASE
          WHEN substring(UPPER(TRIM(veo.embark_port)) FROM '\m((?:BR|CN)[A-Z0-9]{3})\M') IS NOT NULL
            THEN REPLACE(substring(UPPER(TRIM(veo.embark_port)) FROM '\m((?:BR|CN)[A-Z0-9]{3})\M'), 'BRVIT', 'BRVIX')
          WHEN public.normalize_port_code(veo.embark_port) = 'BRVIT' THEN 'BRVIX'
          WHEN public.normalize_port_code(veo.embark_port) IN ('BRSSA', 'CNTAO', 'CNSHA', 'CNTAC', 'CNNGB', 'CNNSA', 'CNZJG')
            THEN public.normalize_port_code(veo.embark_port)
          WHEN UPPER(TRIM(veo.embark_port)) LIKE '%PECEM%' THEN 'BRPEC'
          WHEN UPPER(TRIM(veo.embark_port)) ~ '^[A-Z]{5}$' THEN UPPER(TRIM(veo.embark_port))
          ELSE NULL
        END
      ) AS normalized_pol
    FROM public.vazios_export_operations veo
    INNER JOIN target_rows tr
      ON tr.voyage_id = veo.voyage_id
    GROUP BY veo.voyage_id
  ),
  resolved_pol AS (
    SELECT
      tr.id,
      CASE
        -- Compatibilidade: o snapshot de viagem e a fonte canônica do estado
        -- atual da voyage_pol_schedule. Se houver mais de um POL brasileiro
        -- atual, a linha legada (uma EXP por viagem) permanece sem pol para
        -- revisão manual, em vez de escolher um porto histórico arbitrário.
        WHEN COALESCE(pol_schedule_source.current_br_pol_count, 0) > 1 THEN NULL
        WHEN pol_schedule_source.normalized_pol IS NOT NULL THEN pol_schedule_source.normalized_pol
        ELSE COALESCE(granite_source.normalized_pol, vazios_source.normalized_pol)
      END AS normalized_pol
    FROM target_rows tr
    LEFT JOIN pol_schedule_source
      ON pol_schedule_source.voyage_id = tr.voyage_id
    LEFT JOIN granite_source
      ON granite_source.voyage_id = tr.voyage_id
    LEFT JOIN vazios_source
      ON vazios_source.voyage_id = tr.voyage_id
  )
  UPDATE public.voyage_export_schedules ves
  SET pol = resolved_pol.normalized_pol
  FROM resolved_pol
  WHERE ves.id = resolved_pol.id
    AND resolved_pol.normalized_pol IS NOT NULL;

  -- Residuo sem POL permanece para revisao manual; esta migration nao apaga
  -- linhas porque a origem documental ainda precisa ser conferida caso a caso.
  SELECT COUNT(*)
  INTO v_remaining_null_pol_count
  FROM public.voyage_export_schedules
  WHERE pol IS NULL;

  RAISE NOTICE 'voyage_export_schedules.pol backfill deixou % linha(s) sem POL para revisao manual.', v_remaining_null_pol_count;

  ALTER TABLE public.voyage_export_schedules
    DROP CONSTRAINT IF EXISTS voyage_export_schedules_voyage_id_key;

  ALTER TABLE public.voyage_export_schedules
    DROP CONSTRAINT IF EXISTS voyage_export_schedules_voyage_id_pol_key;

  ALTER TABLE public.voyage_export_schedules
    ADD CONSTRAINT voyage_export_schedules_voyage_id_pol_key UNIQUE (voyage_id, pol);

  IF v_remaining_null_pol_count = 0 THEN
    ALTER TABLE public.voyage_export_schedules
      ALTER COLUMN pol SET NOT NULL;
  ELSE
    -- NOT NULL fica para passo posterior: ainda ha linhas sem porto resolvido.
    RAISE NOTICE 'NOT NULL adiado em voyage_export_schedules.pol ate concluir a revisao manual do residuo.';
  END IF;
END $$;
