# 0004 — Supabase RLS e RPCs como fronteira de segurança

Status: aceito — 2026-06-09

## Contexto

A aplicação roda no navegador e manipula dados sensíveis: clientes, documentos fiscais, invoices, PIX, tabelas de taxas, portal externo e operações destrutivas. Qualquer checagem feita apenas em React pode ser burlada por chamadas diretas ao Supabase.

O projeto também possui duas superfícies de autenticação: usuários internos via Supabase Auth + `user_profiles`, e clientes do portal via Supabase Auth em uma sessão isolada.

## Decisão

Adotar Supabase/Postgres como fronteira real de segurança, com RLS habilitado e operações críticas encapsuladas em RPCs `SECURITY DEFINER`.

- Helpers de banco como `current_user_role()`, `is_active_user()` e `is_admin()` são a base das policies.
- Leituras e escritas operacionais usam `is_active_user()` quando a equipe interna pode operar o dado.
- Escritas financeiras, administração e deletes sensíveis exigem `is_admin()` ou RPCs com validações explícitas.
- Funções `SECURITY DEFINER` devem ter `search_path` controlado, grants mínimos e validação de `auth.uid()`/role quando expostas a usuários autenticados.
- A role `anon` só deve executar funções pensadas para o Portal do Cliente ou fluxos públicos necessários; funções internas não devem ficar expostas a `anon`.
- Edge Functions que usam service role (`provision-portal-user`, `notify-invoice-issued`) devem validar chamador/origem/segredo antes de executar privilégios administrativos.

## Consequências

- **Positivas**: o app pode esconder botões por UX sem depender disso para segurança; fluxos financeiros ficam transacionais; dados do portal ficam escopados ao cliente autenticado.
- **Negativas / custos**: mudanças de schema exigem migration cuidadosa; algumas leituras úteis para UI precisam de RPC para atravessar RLS com escopo seguro; migrations precisam ser aplicadas no Supabase antes do deploy do código dependente.
- **Difícil de reverter**: mover autorização de volta para o cliente aumentaria a superfície de vazamento e quebraria a premissa de produção do sistema.
