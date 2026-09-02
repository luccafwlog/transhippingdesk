-- 377: exceção de invoice do Portal visível a Documentação e Administrativo.
--
-- A emissão de uma taxa local pode deixar o B/L fora do gate do Portal. O
-- alerta continua tendo Documentação como responsável primário, mas o setor
-- Administrativo também precisa enxergar a exceção para acompanhar a
-- comunicação financeira e tratar a causa cadastral/financeira.

UPDATE public.alert_type_catalog
SET audience_departments = ARRAY['documentacao', 'administrativo']::TEXT[]
WHERE type = 'portal_excecao_critica_fatura';

-- Os templates financeiros passam a fazer parte do catálogo versionado do
-- canal. A renderização definitiva continua no código compartilhado, mas o
-- catálogo precisa aceitar os dois tipos para a leitura/validação da Edge.
ALTER TABLE public.customer_communication_templates
  DROP CONSTRAINT IF EXISTS customer_communication_templates_kind_check;

ALTER TABLE public.customer_communication_templates
  ADD CONSTRAINT customer_communication_templates_kind_check
  CHECK (kind IN (
    'aviso_chegada_noa',
    'aviso_prontidao_nor',
    'aviso_atracacao_nob',
    'ce_mercante_taxas',
    'cobranca_demurrage',
    'institucional',
    'livre'
  ));

INSERT INTO public.customer_communication_templates (
  kind, subject_template, body_html_template, body_text_template
)
VALUES
  (
    'ce_mercante_taxas',
    'CE Mercante Disponível e Resumo de Taxas Locais — {{vessel_name}} / {{voyage_number}}',
    '<p>CE Mercante disponível para desembaraço e registro da DI/DUIMP. O resumo de B/Ls e valores em BRL é gerado pelo comunicado.</p>',
    'CE Mercante disponível para desembaraço e registro da DI/DUIMP. O resumo de B/Ls e valores em BRL é gerado pelo comunicado.'
  ),
  (
    'cobranca_demurrage',
    'Cobrança de Demurrage — {{demurrage_number}} — {{vessel_name}} / {{voyage_number}}',
    '<p>A cobrança de Demurrage está disponível no Portal do Cliente. O valor em reais é informativo e será recalculado no dia do pagamento.</p>',
    'A cobrança de Demurrage está disponível no Portal do Cliente. O valor em reais é informativo e será recalculado no dia do pagamento.'
  )
ON CONFLICT (kind) DO UPDATE SET
  subject_template = EXCLUDED.subject_template,
  body_html_template = EXCLUDED.body_html_template,
  body_text_template = EXCLUDED.body_text_template;
