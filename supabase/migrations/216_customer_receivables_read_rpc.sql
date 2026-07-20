-- 209: Fecha o achado P2 406-02 da auditoria pos-merge dos PRs #405/#406.
-- bl_receivables.SELECT usa `USING (public.is_admin())`, mas RLS bem-sucedida
-- retorna zero linhas para quem nao passa no predicado (nao um erro 42501) —
-- Financeiro/Documentacao viam "Nenhum recebivel" mesmo quando existiam
-- registros. CONTEXT.md ("Visualizacao global interna") documenta leitura
-- ampla para usuarios ativos; expoe uma RPC de leitura com metadata de
-- autorizacao explicita em vez de afrouxar a policy da tabela financeira.
CREATE OR REPLACE FUNCTION public.get_customer_receivables(p_customer_id BIGINT)
RETURNS TABLE (
  id BIGINT,
  bl_id TEXT,
  original_amount_brl NUMERIC,
  settled_amount_brl NUMERIC,
  balance_brl NUMERIC,
  status TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT r.id, r.bl_id, r.original_amount_brl, r.settled_amount_brl, r.balance_brl, r.status
  FROM public.bl_receivables r
  WHERE r.customer_id = p_customer_id
  ORDER BY r.updated_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_customer_receivables(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_receivables(BIGINT) TO authenticated;
