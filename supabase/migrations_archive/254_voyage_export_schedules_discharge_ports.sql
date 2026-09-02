-- Intent: a exportacao de uma escala embarca granito E containers, e o destino
-- dessa carga nao pode ser inferido do manifesto (que so existe depois do
-- embarque). O operador passa a informar os portos de descarga no cadastro da
-- escala, e o cabecalho da viagem monta a perna de exportacao a partir deles.
-- Affected objects: public.voyage_export_schedules.
-- Consumers: src/services/voyageExportSchedules.ts,
-- src/services/voyageRouteSchedules.ts,
-- src/components/shared/VoyageScheduleModals.tsx,
-- src/components/voyages/VoyageCard.tsx.
-- Rollback: ALTER TABLE public.voyage_export_schedules DROP COLUMN discharge_ports;

ALTER TABLE public.voyage_export_schedules
  ADD COLUMN IF NOT EXISTS discharge_ports TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.voyage_export_schedules.discharge_ports IS
  'Portos de descarga da carga embarcada nesta escala (ADR 0035). Codigos UN/LOCODE em caixa alta, estrangeiros inclusive; vazio enquanto o destino nao foi definido.';
