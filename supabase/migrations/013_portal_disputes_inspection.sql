-- 013: paridade de Inspeção para disputas do Portal (S11, #659.3 / ADR 0045).
--
-- Extrai o corpo atual de portal_list_disputes() para o núcleo privado
-- _portal_list_disputes_core(p_customer_id) e cria os dois invólucros que
-- delegam ao mesmo núcleo: portal_list_disputes() (Portal, via
-- current_portal_customer_id()) e portal_inspect_list_disputes(p_customer_id)
-- (Inspeção interna, via _portal_inspect_guard). Núcleo sem EXECUTE externo;
-- invólucros com search_path fixo e grants explícitos.
-- Rollback: DROP FUNCTION public.portal_inspect_list_disputes(bigint),
-- public._portal_list_disputes_core(bigint) e restaurar o corpo anterior em
-- public.portal_list_disputes() a partir de 002_business_logic_and_security.sql.

CREATE OR REPLACE FUNCTION public._portal_list_disputes_core(p_customer_id bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', d.id, 'demurrage_invoice_id', d.demurrage_invoice_id,
      'doc_number', di.doc_number, 'state', d.state,
      'next_responder', d.next_responder, 'subject', d.subject,
      'created_at', d.created_at, 'updated_at', d.updated_at,
      'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'author_type', m.author_type, 'body', m.body, 'next_responder', m.next_responder, 'created_at', m.created_at, 'attachments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'file_name', a.file_name, 'mime_type', a.mime_type, 'storage_path', a.storage_path)) FROM public.demurrage_dispute_attachments a WHERE a.message_id = m.id), '[]'::jsonb)) ORDER BY m.created_at) FROM public.demurrage_dispute_messages m WHERE m.dispute_id = d.id), '[]'::jsonb)
    ) ORDER BY d.created_at DESC)
    FROM public.demurrage_disputes d
    JOIN public.demurrage_invoices di ON di.id = d.demurrage_invoice_id
    WHERE d.customer_id = p_customer_id
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public._portal_list_disputes_core(bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_list_disputes()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RETURN public._portal_list_disputes_core(public.current_portal_customer_id());
END;
$$;

REVOKE ALL ON FUNCTION public.portal_list_disputes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_list_disputes() TO authenticated;

CREATE OR REPLACE FUNCTION public.portal_inspect_list_disputes(p_customer_id bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RETURN public._portal_list_disputes_core(public._portal_inspect_guard(p_customer_id));
END;
$$;

REVOKE ALL ON FUNCTION public.portal_inspect_list_disputes(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_inspect_list_disputes(bigint) TO authenticated;
