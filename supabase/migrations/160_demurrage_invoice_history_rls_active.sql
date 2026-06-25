-- Hardening de RLS: alinha demurrage_invoice_history ao contrato da tabela-pai.
--
-- Contexto: a migration 153_demurrage_invoice_history criou a tabela com a policy
--   SELECT `TO authenticated USING (true)`, afirmando "espelhar demurrage_invoices".
--   Porem demurrage_invoices teve o SELECT restrito a `is_active_user()` em
--   042_rls_module_hardening. Como clientes do Portal tambem sao `authenticated`
--   (Supabase Auth, ver 044/084), `USING (true)` os deixava ler via PostgREST
--   (`GET /rest/v1/demurrage_invoice_history`) o historico financeiro de TODOS os
--   clientes -- PTAX, totais USD/BRL e descontos negociados (Broken Access Control,
--   OWASP A01). E um desvio de default-deny, nao uma exposicao intencional: o
--   Portal nunca le esta tabela direto (consumidores sao internos:
--   src/services/reconciliacao.ts e src/services/demurrage/demurrageKpis.ts).
--
-- Correcao: substitui a policy SELECT por `is_active_user()`, espelhando de fato
--   a tabela-pai. Escrita continua exclusivamente via RPCs SECURITY DEFINER
--   (recalculo/pagamento), que ignoram RLS -- nao ha policy de escrita por design.
-- Escopo: aditivo (reescreve uma policy). Consumidores internos sao usuarios
--   ativos, logo seguem funcionando; o Portal nao e afetado.
-- Rollback: recriar a policy com `USING (true)` reabriria o desvio -- nao fazer
--   sem substituir por controle equivalente.

ALTER TABLE public.demurrage_invoice_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_demurrage_invoice_history"
  ON public.demurrage_invoice_history;
DROP POLICY IF EXISTS demurrage_invoice_history_select_active
  ON public.demurrage_invoice_history;

CREATE POLICY demurrage_invoice_history_select_active
  ON public.demurrage_invoice_history FOR SELECT
  TO authenticated USING (public.is_active_user());
