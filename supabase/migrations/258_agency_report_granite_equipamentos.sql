-- Granito é a seção de carga carregada do ADR e pertence a Equipamentos.
--
-- A UI passou a refletir essa regra, mas as funções SQL vigentes continuaram
-- com o dono e o rótulo da migration 253. Como os gates de sign-off e de
-- pendência consultam agency_report_section_owner, a divergência bloqueava a
-- assinatura de Equipamentos e exibia o rótulo antigo em superfícies do banco.
--
-- Esta migration é aditiva: não reescreve registros nem migrations históricas.
-- As chaves aposentadas continuam legíveis para audit_logs e snapshots.

CREATE OR REPLACE FUNCTION public.agency_report_section_owner(p_section TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_section
    WHEN 'datas' THEN 'operacoes'
    WHEN 'veiculos' THEN 'equipamentos'
    WHEN 'carga_carregada' THEN 'equipamentos'
    WHEN 'vazios_embarcados' THEN 'equipamentos'
    WHEN 'carga_descarregada' THEN 'documentacao'
    WHEN 'vazios_descarregados' THEN 'documentacao'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.agency_report_section_label(p_section TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_section
    WHEN 'datas' THEN 'Escala'
    WHEN 'carga_descarregada' THEN 'Carga descarregada'
    WHEN 'carga_carregada' THEN 'Granito'
    WHEN 'veiculos' THEN 'Veículos'
    WHEN 'vazios_embarcados' THEN 'Embarque de vazios'
    WHEN 'vazios_descarregados' THEN 'Vazios descarregados'
    WHEN 'operacao_patio' THEN 'Operação de pátio'
    WHEN 'ocorrencias' THEN 'Ocorrências'
    ELSE p_section
  END;
$$;

REVOKE ALL ON FUNCTION public.agency_report_section_owner(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agency_report_section_owner(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.agency_report_section_label(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agency_report_section_label(TEXT) TO authenticated;
