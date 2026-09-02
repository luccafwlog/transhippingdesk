-- Migration 045: Função SQL para contagem distinta de containers server-side.
--
-- Contexto: o Painel carregava batches de 1000 linhas de bl_containers e
-- deduplicava no browser. Em volumes grandes isso causava lentidão O(n).
-- Esta função executa a mesma lógica (normalize → upper + trim, distinct)
-- diretamente no banco, retornando apenas um bigint.

CREATE OR REPLACE FUNCTION public.count_distinct_containers()
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT COUNT(DISTINCT upper(trim(container_number)))
  FROM public.bl_containers;
$$;

REVOKE ALL ON FUNCTION public.count_distinct_containers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_distinct_containers() TO authenticated;
