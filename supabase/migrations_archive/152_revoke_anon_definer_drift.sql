-- Renumbered from 20260624110000 (original timestamped migration: 20260624110000_revoke_anon_definer_drift.sql).
-- Verificação runtime do Plano 08 (produção fgmkhbzhaeebrsizwccx, 2026-06-24)
-- mostrou que o advisor de segurança ainda acusa 9 funcoes SECURITY DEFINER
-- executaveis por `anon`. Oito delas sao desvio (drift) do default-deny da
-- ADR 0011: funcoes recriadas DEPOIS da revogacao abrangente de
-- 20260609225321 reganharam o grant default de `anon` que o Supabase concede a
-- novas funcoes no schema public. As afetadas:
--   - financeiras (com guard interno admin, NAO exploraveis, mas em desvio de ACL):
--     cancel_invoice, create_invoice_from_bls, create_invoice_from_bls_with_ledger,
--     settle_invoice_refund
--   - helper sem guard, exposto via REST como oraculo booleano:
--     bl_has_portal_release(text)
--   - funcoes de trigger (RETURNS trigger; PostgREST nao expoe, inofensivas mas
--     inconsistentes): notify_invoice_issued, notify_demurrage_issued,
--     notify_dispute_responded
--
-- A nona, portal_resolve_login(text), e a UNICA excecao pre-auth permitida pela
-- ADR 0013 e DEVE manter `anon`.
--
-- Correcao: reaplica a revogacao abrangente de 20260609225321 (mesmo DO-block),
-- agora com a carve-out de portal_resolve_login. Idempotente: revogar grant
-- inexistente e no-op. Chamadas internas definer->definer usam o privilegio do
-- owner (postgres), entao revogar anon/authenticated de helpers como
-- bl_has_portal_release nao quebra o fluxo do Portal.
--
-- Rollback (caso a caso):
--   GRANT EXECUTE ON FUNCTION public.<fn>(<args>) TO anon;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig,
           p.prorettype = 'trigger'::regtype AS is_trigger
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.proname <> 'portal_resolve_login'   -- excecao ADR 0013
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    IF r.is_trigger THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.sig);
    END IF;
  END LOOP;
END $$;

-- Reafirma explicitamente a excecao da ADR 0013.
GRANT EXECUTE ON FUNCTION public.portal_resolve_login(text) TO anon;
