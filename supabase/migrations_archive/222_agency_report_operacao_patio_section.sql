-- Agency Departure Report: oitava secao "operacao_patio" (ADR 0029).
-- Intent: consolida storage, overtime, depots/embarque direto, OS e servicos
-- extra dos vazios de exportacao numa secao propria sob Equipamentos, separada
-- de "vazios_embarcados". Nao move dado nenhum (a secao so ganha resolucao
-- propria); o conteudo exibido continua vindo do modulo de Vazios de
-- Exportacao (VoyageAgencyReportTab, Task 6).
-- Afetadas: agency_departure_report_signoffs.section (CHECK),
-- agency_report_section_owner. Consumidores:
-- src/services/agencyDepartureReport.ts (AgencyReportSection).
-- Aditiva: nenhuma linha existente e afetada (nenhum sign-off pre-existente
-- usa 'operacao_patio').
-- Rollback: reaplicar o CHECK de 7 secoes da migration 213 (nenhum dado usa a
--           oitava secao antes desta migration) e o ELSE NULL anterior de
--           agency_report_section_owner.

ALTER TABLE public.agency_departure_report_signoffs
  DROP CONSTRAINT IF EXISTS agency_departure_report_signoffs_section_check;
ALTER TABLE public.agency_departure_report_signoffs
  ADD CONSTRAINT agency_departure_report_signoffs_section_check CHECK (section IN (
    'datas', 'carga_descarregada', 'carga_carregada', 'veiculos',
    'vazios_embarcados', 'vazios_descarregados', 'ocorrencias', 'operacao_patio'
  ));

CREATE OR REPLACE FUNCTION public.agency_report_section_owner(p_section TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_section
    WHEN 'datas' THEN 'operacoes'
    WHEN 'ocorrencias' THEN 'operacoes'
    WHEN 'veiculos' THEN 'equipamentos'
    WHEN 'vazios_embarcados' THEN 'equipamentos'
    WHEN 'operacao_patio' THEN 'equipamentos'
    WHEN 'carga_descarregada' THEN 'documentacao'
    WHEN 'carga_carregada' THEN 'documentacao'
    WHEN 'vazios_descarregados' THEN 'documentacao'
    ELSE NULL
  END;
$$;
