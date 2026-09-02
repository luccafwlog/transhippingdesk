-- Expõe a sincronização da fila de reconciliação por um wrapper autorizado.
-- O helper SECURITY DEFINER continua interno; o frontend não recebe acesso
-- direto a uma função que ignora RLS.

CREATE OR REPLACE FUNCTION public.refresh_customer_reconciliation_queue_for_bl(p_bl_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_non_equipamentos_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para atualizar a fila de reconciliação.' USING ERRCODE = '42501';
  END IF;

  PERFORM public.sync_customer_reconciliation_queue_for_bl(p_bl_id);
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_customer_reconciliation_queue_for_bl(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_customer_reconciliation_queue_for_bl(TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_customer_reconciliation_queue_for_bl(TEXT) FROM PUBLIC, anon, authenticated;
