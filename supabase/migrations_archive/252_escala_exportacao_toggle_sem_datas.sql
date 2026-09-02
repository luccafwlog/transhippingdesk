-- Intent: fechar o bloco 1 da ADR 0035 (nota editorial de 2026-08-03) no schema.
-- As datas passam a ser exclusivamente da escala, portanto voyage_export_schedules
-- perde eta/etb; a declaracao de exportacao deixa de ser inferida da existencia da
-- linha e passa a ser explicita em tem_exportacao; e pol deixa de admitir nulo,
-- encerrando o residuo que a migration 250 havia adiado.
-- Affected objects: public.voyage_export_schedules.
-- Consumers: src/services/voyageExportSchedules.ts,
-- src/services/voyageRouteSchedules.ts, src/services/lineup.ts,
-- src/components/shared/VoyageScheduleModals.tsx,
-- src/components/voyages/VoyageVisaoTab.tsx.
-- Rollback: recriar eta/etb (date, nullable), remover tem_exportacao, devolver
-- pol para nullable e recriar o indice parcial de residuo da migration 250.

DO $$
DECLARE
  v_null_pol_count INTEGER := 0;
BEGIN
  SELECT COUNT(*) INTO v_null_pol_count
  FROM public.voyage_export_schedules
  WHERE pol IS NULL;

  IF v_null_pol_count > 0 THEN
    RAISE EXCEPTION
      'voyage_export_schedules ainda tem % linha(s) sem pol; resolva o residuo antes de aplicar 252.',
      v_null_pol_count;
  END IF;
END $$;

-- O residuo sem POL deixa de existir, e com ele o indice parcial que o tolerava.
DROP INDEX IF EXISTS public.voyage_export_schedules_one_null_pol_per_voyage;

ALTER TABLE public.voyage_export_schedules
  ALTER COLUMN pol SET NOT NULL;

-- As datas da escala moram no portador (voyage_pod_schedule) e sao lidas pela
-- projecao unificada. Mante-las aqui criava um segundo lugar para digitar data
-- que nenhuma superficie voltava a ler.
ALTER TABLE public.voyage_export_schedules
  DROP COLUMN IF EXISTS eta,
  DROP COLUMN IF EXISTS etb;

-- A existencia da linha deixa de ser a declaracao de que a escala embarca: o
-- operador declara antes de conhecer quantidades, e a linha sobrevive ao
-- desligamento apenas enquanto guarda o proprio registro do desligamento.
ALTER TABLE public.voyage_export_schedules
  ADD COLUMN IF NOT EXISTS tem_exportacao BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.voyage_export_schedules.tem_exportacao IS
  'Declaracao explicita de que a escala tera embarque (ADR 0035, nota editorial 2026-08-03). Nao e derivado de quantidade preenchida.';

COMMENT ON COLUMN public.voyage_export_schedules.pol IS
  'Porto brasileiro da escala. Identidade (voyage_id, pol); as datas ficam na escala, nao aqui.';
