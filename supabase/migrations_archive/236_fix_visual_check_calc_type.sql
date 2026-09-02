-- Corrige o backfill da 234: o seed 233 gravou visual_check como
-- 'per_container_flag', que a 234 mapeou para 'fixo_por_container'. Fixo por
-- container cobra TODOS os containers do depot, sem gate por flag — antes só
-- os containers marcados eram cobrados. Pela ADR 0032, visual check é serviço
-- de tipo Quantidade.

UPDATE public.depot_services
SET calc_type = 'quantidade',
    subject_to_overtime = FALSE
WHERE name = 'visual_check'
  AND calc_type = 'fixo_por_container';
