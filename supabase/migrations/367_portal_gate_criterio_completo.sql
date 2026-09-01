-- 367: prontidão de Portal no gate de faturamento passa a valer o critério
-- completo da ADR 0054 (issue #638).
--
-- A migration 337 devolveu 'Acesso ao portal nao provisionado' ao produtor
-- canônico `compute_bl_review_pendencies`, restaurando o gate que a 188 havia
-- removido. O critério dela, porém, é mais frouxo do que a decisão: basta conta
-- `active` com `auth_user_id`. Passam pelo gate contas cujo convite está
-- pendente ou expirado, cujo envio falhou, contas suspensas e contas cujo
-- e-mail de recuperação sofreu bounce/complaint ou está ausente — justamente os
-- casos em que o cliente NÃO recebe nem vê a fatura, que é o motivo de o gate
-- existir.
--
-- Esta migration redefine apenas a checagem de portal dentro do produtor
-- canônico. Tudo o mais da 337 permanece: as demais pendências, os alertas
-- (`reconcile_bl_review_alerts`) e os triggers de recomputação em
-- `customer_portal_accounts` e `customer_contacts` — é por eles que provisionar
-- o portal volta a liberar os B/Ls afetados sem intervenção manual.
--
-- Alcance: o gate atinge a EMISSÃO (a fronteira que promove `ready_for_billing`
-- consulta esta função e recusa gravando `billing_hold_reason`), nunca o
-- cálculo. As taxas continuam sendo calculadas para conferência com o bloqueio
-- aberto.
--
-- Rollback: reaplicar o corpo da 337 (conta `active = true` com
-- `auth_user_id IS NOT NULL`), que volta a aceitar convite pendente, conta
-- suspensa e e-mail de recuperação suprimido.

CREATE OR REPLACE FUNCTION public.compute_bl_review_pendencies(
  p_customer_id BIGINT, p_cargo_mode TEXT, p_bb_weight_ton NUMERIC
)
RETURNS TEXT[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_reasons TEXT[] := ARRAY[]::TEXT[];
  v_has_email BOOLEAN := false;
  v_portal_ready BOOLEAN := false;
BEGIN
  IF p_customer_id IS NULL THEN
    v_reasons := array_append(v_reasons, 'Cliente nao vinculado');
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.customer_contacts c
      WHERE c.customer_id = p_customer_id
        AND NULLIF(btrim(c.email), '') IS NOT NULL
    ) INTO v_has_email;

    IF NOT v_has_email THEN
      v_reasons := array_append(v_reasons, 'Cliente sem e-mail cadastrado');
    END IF;

    -- Critério da ADR 0054: conta ativa, vinculada ao usuário de autenticação e
    -- com e-mail de recuperação utilizável. `active` sozinho não basta —
    -- `account_situation` é a máquina de estados do provisionamento (178) e
    -- `recovery_email_status` é marcado pelo webhook de bounce/complaint (299),
    -- independente dela.
    SELECT EXISTS (
      SELECT 1
      FROM public.customer_portal_accounts a
      WHERE a.customer_id = p_customer_id
        AND a.active = true
        AND a.account_situation = 'ativo'
        AND a.auth_user_id IS NOT NULL
        AND NULLIF(btrim(a.recovery_email), '') IS NOT NULL
        AND COALESCE(a.recovery_email_status, 'ok') = 'ok'
        AND NOT EXISTS (
          SELECT 1
          FROM public.portal_suppressed_emails s
          WHERE s.email = lower(btrim(a.recovery_email))
        )
    ) INTO v_portal_ready;

    IF NOT v_portal_ready THEN
      v_reasons := array_append(v_reasons, 'Acesso ao portal nao provisionado');
    END IF;
  END IF;

  IF p_cargo_mode = 'carga_solta'
     AND (p_bb_weight_ton IS NULL OR p_bb_weight_ton <= 0) THEN
    v_reasons := array_append(v_reasons, 'Peso BB ausente');
  END IF;

  RETURN v_reasons;
END;
$function$;

REVOKE ALL ON FUNCTION public.compute_bl_review_pendencies(BIGINT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_bl_review_pendencies(BIGINT, TEXT, NUMERIC) TO service_role;
