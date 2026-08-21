-- 335: gravação autorizada de metadados de anexos da Dispute.

CREATE OR REPLACE FUNCTION public.add_demurrage_dispute_attachment(
  p_message_id BIGINT,
  p_storage_path TEXT,
  p_file_name TEXT,
  p_mime_type TEXT,
  p_size_bytes BIGINT
)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_message public.demurrage_dispute_messages%ROWTYPE;
  v_dispute public.demurrage_disputes%ROWTYPE;
  v_id BIGINT;
BEGIN
  IF auth.uid() IS NULL OR (NOT public.is_active_user() AND public.current_portal_customer_id() IS NULL) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_storage_path), '') IS NULL OR NULLIF(btrim(p_file_name), '') IS NULL
     OR NULLIF(btrim(p_mime_type), '') IS NULL OR p_size_bytes IS NULL
     OR p_size_bytes <= 0 OR p_size_bytes > 10485760 THEN
    RAISE EXCEPTION 'Anexo inválido.' USING ERRCODE = '22023';
  END IF;
  IF p_mime_type NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'text/plain') THEN
    RAISE EXCEPTION 'Tipo de anexo não permitido.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_message FROM public.demurrage_dispute_messages WHERE id = p_message_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mensagem não encontrada.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_dispute FROM public.demurrage_disputes WHERE id = v_message.dispute_id;
  IF NOT public.is_active_user() AND v_dispute.customer_id <> public.current_portal_customer_id() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF p_storage_path NOT LIKE (v_dispute.customer_id::TEXT || '/disputes/' || v_dispute.id::TEXT || '/%') THEN
    RAISE EXCEPTION 'Caminho de anexo inválido.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.demurrage_dispute_attachments(message_id, dispute_id, customer_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  VALUES (v_message.id, v_dispute.id, v_dispute.customer_id, p_storage_path, p_file_name, p_mime_type, p_size_bytes, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.add_demurrage_dispute_attachment(BIGINT, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_demurrage_dispute_attachment(BIGINT, TEXT, TEXT, TEXT, BIGINT) TO authenticated;
