-- 290: Fecha a escrita global de import_manifest_transactional encontrada na
-- auditoria de seguranca de 2026-08-12 (docs/archive/audits/) e revoga o
-- grant residual a anon em portal_invoice_details (achado 3.5 da mesma
-- auditoria).
--
-- Raiz herdada da migration 257: o cliente do Portal recebe o MESMO role
-- `authenticated` do usuario interno. import_manifest_transactional era
-- SECURITY DEFINER com EXECUTE para authenticated e sem nenhuma guarda --
-- uma sessao de cliente criava import_batches e bls em viagem arbitraria,
-- com autoria escolhida por ela.
--
-- A guarda e a mesma dos irmaos (legacy_205, legacy_148): exige sessao
-- interna ativa E amarra o parametro de autoria a auth.uid(), porque
-- p_uploaded_by vem do chamador e e o que ancora o rate limit e a trilha de
-- auditoria.
--
-- Rollback: remover a guarda reabre a escrita global; nao fazer sem controle
-- equivalente. Reconceder EXECUTE a anon em portal_invoice_details reabre o
-- achado 3.5; a guarda current_portal_customer_id() permanece como defesa em
-- profundidade mesmo sem o grant.
CREATE OR REPLACE FUNCTION public.import_manifest_transactional(
  p_filename text,
  p_voyage_id bigint,
  p_uploaded_by uuid,
  p_cargo_mode text,
  p_file_hash text,
  p_total_bls integer,
  p_total_containers integer,
  p_bls jsonb,
  p_containers jsonb,
  p_errors jsonb,
  p_apply_overwrites boolean DEFAULT false
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result BIGINT;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar manifesto.'
      USING ERRCODE = '42501';
  END IF;

  v_result := public.import_manifest_transactional_legacy_165(
    p_filename,
    p_voyage_id,
    p_uploaded_by,
    p_cargo_mode,
    p_file_hash,
    p_total_bls,
    p_total_containers,
    p_bls,
    p_containers,
    p_errors,
    p_apply_overwrites
  );

  UPDATE public.bls AS b
  SET
    suggested_customer_id = CASE
      WHEN item ? 'suggested_customer_id' THEN NULLIF(item->>'suggested_customer_id', '')::BIGINT
      ELSE b.suggested_customer_id
    END,
    customer_reconciliation_status = COALESCE(
      NULLIF(item->>'customer_reconciliation_status', ''),
      CASE
        WHEN NULLIF(item->>'customer_id', '') IS NOT NULL THEN 'reconciled'
        ELSE 'missing_customer'
      END
    )
  FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS item
  WHERE b.id = item->>'id';

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.import_manifest_transactional(
  text, bigint, uuid, text, text, integer, integer, jsonb, jsonb, jsonb, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_manifest_transactional(
  text, bigint, uuid, text, text, integer, integer, jsonb, jsonb, jsonb, boolean
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.portal_invoice_details(bigint) FROM anon;
