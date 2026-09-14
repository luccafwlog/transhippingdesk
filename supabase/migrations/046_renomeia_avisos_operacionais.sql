--
-- 046 — Renomeia o lado português dos avisos operacionais
--
-- Os rótulos mentiam sobre o tempo verbal. O NOA sai cinco dias ANTES do ETA,
-- e chamá-lo de "Aviso de Chegada" prometia uma chegada consumada; o NOR, que
-- é a chegada de fato (ATA), chamava-se "Prontidão de Descarga". Os dois
-- trocam de nome:
--
--   NOA  Aviso de Chegada       -> Chegada Próxima
--   NOR  Prontidão de Descarga  -> Aviso de Chegada
--
-- O NOB já se chamava Aviso de Atracação e não muda.
--
-- O lado inglês do assunto bilíngue é preservado: `Notice of Arrival` e
-- `Notice of Readiness` são os termos de mercado que o cliente estrangeiro
-- reconhece, e trocá-los quebraria o par de tradução.
--
-- ponytail: a tabela `customer_communication_templates` é dado de referência —
-- quem renderiza de fato é `src/services/customerCommunicationTemplates.ts`,
-- compartilhado com o auto-runner por `_shared/customerCommunicationTemplates.ts`.
-- Deixar as duas cópias divergirem é o que transforma uma tabela inerte num
-- sósia enganoso, então esta migration as mantém alinhadas. O upgrade é a
-- tabela passar a ser lida no envio ou deixar de existir; enquanto as duas
-- coexistirem, toda mudança de assunto precisa vir em par.
--

UPDATE public.customer_communication_templates
   SET subject_template = 'Notice of Arrival / Chegada Próxima — {{vessel_name}} / {{voyage_number}} — Porto de {{port}}'
 WHERE kind = 'aviso_chegada_noa'
   AND subject_template = 'Notice of Arrival / Aviso de Chegada — {{vessel_name}} / {{voyage_number}} — Porto de {{port}}';

UPDATE public.customer_communication_templates
   SET subject_template = 'Notice of Readiness / Aviso de Chegada — {{vessel_name}} / {{voyage_number}} — Porto de {{port}}'
 WHERE kind = 'aviso_prontidao_nor'
   AND subject_template = 'Notice of Readiness / Prontidão de Descarga — {{vessel_name}} / {{voyage_number}} — Porto de {{port}}';
