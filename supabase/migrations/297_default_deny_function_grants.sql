-- 297: inverte o default de grants de função em `public` e limpa o resíduo aberto.
--
-- Intenção (auditoria 2026-08-14, achado A-06). O Supabase mantém, no schema
-- `public`, um ALTER DEFAULT PRIVILEGES que concede EXECUTE a `anon` e
-- `authenticated` em TODA função criada. Somado ao default embutido do próprio
-- PostgreSQL (EXECUTE a PUBLIC), isso faz cada função nascer ABERTA: a segurança
-- passa a depender de o autor lembrar do REVOKE. Foi essa causa que gerou cinco
-- migrations corretivas da mesma família — 078, 088, 093, 152 e 257 — e o padrão
-- se repete porque o esquecimento falha aberto.
--
-- Esta migration troca o modo de falha. Duas partes:
--
--   1. O default passa a REVOGAR. Função nova nasce sem EXECUTE para PUBLIC,
--      `anon` e `authenticated`; quem precisa de acesso concede explicitamente na
--      própria migration. Esquecer passa a quebrar fechado (erro de permissão em
--      teste) em vez de abrir calado.
--
--   2. Varredura do resíduo. A 152 aplicou esta disciplina apenas às funções
--      SECURITY DEFINER; as demais nunca foram varridas, e toda função criada
--      depois dela reganhou o grant do default. Levantamento em produção
--      (fgmkhbzhaeebrsizwccx, 2026-08-14): das 252 funções de `public` do
--      projeto, 51 executáveis por `anon` e 38 com grant a PUBLIC — entre elas as
--      RPCs vivas do Portal (portal_list_invoices, portal_invoice_details,
--      portal_get_profile), os geradores de PIX (build_transshipping_pix_payload,
--      pix_tlv, pix_crc16_ccitt) e escritas como mark_bl_ready_and_create_invoice.
--
-- Impacto real hoje: nenhum vazamento. As funções do Portal resolvem o cliente
-- por current_portal_customer_id(), que é NULL para `anon`, e as não-DEFINER caem
-- na RLS. O que se fecha é superfície — a mesma classe do achado A-03 (migration
-- 296), quatro vezes maior.
--
-- Por que preservar `authenticated`: é o caminho normal do app (front-end interno
-- e Portal falam com PostgREST autenticados). Verificado no levantamento que
-- NENHUMA função depende de PUBLIC ou de `anon` para o acesso do usuário logado —
-- todas as 38 com PUBLIC e as 51 com `anon` têm o grant de `authenticated`
-- concedido à parte. Por isso revogar PUBLIC/anon não remove acesso de ninguém.
-- A exceção é a função de trigger, que perde `authenticated` direto pela mesma
-- razão da 152: trigger roda com o privilégio do owner e nunca é chamada por RPC.
--
-- Escopo: apenas grants, e apenas funções de `public` pertencentes a `postgres`.
-- As 219 funções de `supabase_admin` no mesmo schema são das extensões btree_gist
-- e pg_trgm — não são do projeto e ficam intocadas. Nenhuma função é criada,
-- alterada ou removida; nenhuma policy é tocada.
--
-- Exceção pré-autenticação preservada: `portal_ship_schedule()`, vitrine pública
-- da programação de navios por decisão de projeto (achado A-02, registrada em
-- docs/ARCHITECTURE.md). É a ÚNICA viva. A exceção `anon` de
-- `portal_resolve_login(text)` (ADR 0013) foi encerrada na migration 182, quando o
-- login passou a ser resolvido pela Edge Function `portal-login` com service_role;
-- o wrapper `portalResolveLogin` em src/services/portalBilling.ts é código morto,
-- sem nenhum chamador de produção. Esta migration NÃO a ressuscita.
--
-- Rollback:
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.<nome>(<args>) TO <role>;  -- caso a caso

-- ---------------------------------------------------------------------------
-- 1. O default passa a fechar.
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Limpeza do resíduo já criado sob o default aberto.
-- ---------------------------------------------------------------------------
DO $default_deny$
DECLARE
  r RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS signature,
           p.prorettype = 'trigger'::regtype AS is_trigger
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND pg_get_userbyid(p.proowner) = 'postgres'
      AND p.proname <> 'portal_ship_schedule'   -- vitrine pública (achado A-02)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.signature);
    IF r.is_trigger THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.signature);
    END IF;
    v_count := v_count + 1;
  END LOOP;

  -- Guarda de sanidade: o levantamento contou 252 funções do projeto. Contagem
  -- zero significa que o filtro deixou de casar (dono ou schema mudou) e que a
  -- varredura virou no-op silenciosa — falhar é melhor do que aplicar sem efeito.
  IF v_count = 0 THEN
    RAISE EXCEPTION 'Nenhuma função de public pertencente a postgres foi varrida; verifique o filtro antes de aplicar.';
  END IF;

  RAISE NOTICE 'Funções varridas: %', v_count;
END;
$default_deny$;

-- Reafirma a única exceção pré-autenticação viva, de forma explícita e visível.
GRANT EXECUTE ON FUNCTION public.portal_ship_schedule() TO anon;
