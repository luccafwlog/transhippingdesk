-- Renumbered from 20260624100000 (original timestamped migration: 20260624100000_revoke_anon_portal_read_rpcs.sql).
-- A migration 20260615220000_portal_ce_mercante_gate.sql concedeu EXECUTE a
-- `anon` em seis RPCs de leitura do Portal. Isso contradiz a fronteira de
-- seguranca documentada: a ADR 0011 estabelece default-deny de `anon` em
-- funcoes privilegiadas e a ADR 0013 define `portal_resolve_login(text)` como a
-- UNICA excecao pre-autenticacao permitida para `anon`.
--
-- Na pratica essas funcoes ja sao inofensivas para sessoes anonimas porque
-- resolvem o cliente por `current_portal_customer_id()`, que lanca 28000 quando
-- `auth.uid()` e nulo. Mesmo assim o grant a `anon` e um desvio de default-deny
-- (defense-in-depth enfraquecido), marcado como Suspeita: ACL em
-- docs/RASTREABILIDADE.md. Esta migration realinha as ACLs ao contrato das ADRs
-- revogando `anon` e preservando `authenticated`.
--
-- Rollback: reconceder `anon` reabriria o desvio de default-deny — nao fazer
-- sem substituir por controle equivalente.

REVOKE EXECUTE ON FUNCTION public.portal_list_operation_bls() FROM anon;
REVOKE EXECUTE ON FUNCTION public.portal_list_consolidatable_receivables() FROM anon;
REVOKE EXECUTE ON FUNCTION public.portal_list_invoices() FROM anon;
REVOKE EXECUTE ON FUNCTION public.portal_invoice_details(bigint) FROM anon;
REVOKE EXECUTE ON FUNCTION public.portal_list_demurrage_invoices() FROM anon;
REVOKE EXECUTE ON FUNCTION public.portal_get_demurrage_invoice_detail(bigint) FROM anon;
