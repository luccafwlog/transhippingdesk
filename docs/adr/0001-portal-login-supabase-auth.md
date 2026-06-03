# 0001 — Login do Portal do Cliente via Supabase Auth (email + senha)

Status: aceito — 2026-06-03

## Contexto

O Portal do Cliente nasceu com dois caminhos de autenticação coexistindo:

- **Legado**: Conta de Portal identificada por **CNPJ + senha** (`portal_login`, `password_hash`), com sessão por token em `sessionStorage`.
- **Supabase Auth**: Conta vinculada a um usuário `auth.users` (`auth_user_id` + `portal_email`), login por **email + senha**, sessão gerida pelo próprio Supabase.

Na prática, o login era sempre chaveado por CNPJ (`usePortalAuth.signIn` → `portal_check_auth_method(p_cnpj_cpf)`), mesmo para contas Supabase Auth — o CNPJ servia só para descobrir o email. O provisionamento (`upsert_customer_portal_account`, chamado pela ficha do cliente) criava **apenas** contas legadas, apesar de a UI pedir "Email de contato + Senha". A Edge Function `provision-portal-user` (que cria o usuário Auth de verdade) existia no repositório mas **não estava deployada nem conectada** ao front.

Resultado: o cliente precisava logar por CNPJ embora o admin tivesse cadastrado email + senha — uma incoerência entre o modelo mental e a implementação. Havia exatamente uma Conta de Portal em produção, legada.

## Decisão

Adotar **email + senha via Supabase Auth como o único modelo de autenticação** do Portal do Cliente, abandonando o caminho legado por CNPJ.

- A tela de login passa a pedir email + senha e autentica direto em `supabase.auth.signInWithPassword`; o overview da sessão é resolvido por `auth.uid()` (`portal_get_session_overview_v2`).
- O provisionamento passa a criar/atualizar o usuário Supabase Auth: a Edge Function `provision-portal-user` é deployada e conectada à ficha do cliente.
- A única conta legada existente é descartada (não há migração de dados a preservar).
- O caminho legado (CNPJ, `password_hash`, token em `sessionStorage`) é removido do fluxo de login.

## Consequências

- **Positivas**: um só modelo de auth (menos código, menos superfície de manutenção e de XSS); login coerente com o que o admin cadastra; sessão e reset de senha apoiados na infra do Supabase.
- **Negativas / custos**: depende de uma Edge Function deployada com `SUPABASE_SERVICE_ROLE_KEY` e `APP_URL` configuradas; provisionar uma conta deixa de ser uma única chamada RPC (cria a linha da conta e então invoca a function).
- **Difícil de reverter**: remove o `password_hash`/token legado e apaga a conta existente. Reintroduzir o login por CNPJ exigiria restaurar todo o caminho legado.
