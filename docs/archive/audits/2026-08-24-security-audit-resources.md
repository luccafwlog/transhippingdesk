# Recursos da auditoria de segurança do sistema

Escopo: repositório local completo do Transhipping Desk, sem acesso nem testes
ativos contra produção. Auditoria executada em 2026-08-24.

## Superfície avaliada

- SPA React 19 / Vite e cabeçalhos de segurança em `vercel.json`;
- Autenticação interna e Portal do Cliente via Supabase Auth (clientes isolados);
- RLS, grants, RPCs `SECURITY DEFINER` e 340 migrations Supabase;
- 12 Edge Functions Deno em `supabase/functions/` e helpers em `_shared/`;
- Importadores de planilhas (Baplie, B/L, EDI, Carga Solta, Granito, Vazios, Veículos);
- Telemetria (Sentry / Vercel Analytics) com redação de PII e query strings;
- Dependências npm, segredos versionados e gates de CI/testes.

## Classes de risco aplicáveis

| Área | Riscos principais | Padrão / Referência |
|---|---|---|
| Autenticação | Enumeração, brute force, colisão de sessão, oráculo de tempo | OWASP A07 / CWE-307 |
| Autorização | IDOR, vazamento de RLS (`USING (true)`), RPC sem guarda | OWASP A01 / CWE-862 |
| Banco de Dados | Grants excessivos a `anon`/`public`, `search_path` mutável | OWASP A01 / A05 |
| Edge Functions | Falha em transações/compensações, CORS aberto, webhook forjado | OWASP A04 / A05 / A08 |
| Frontend | XSS (`dangerouslySetInnerHTML`, `eval`), clickjacking, token em URL | OWASP A03 / A04 / A05 |
| Telemetria | Vazamento de tokens de convite/reset e PII (CNPJ, CPF, email) | OWASP A09 / CWE-532 |
| Supply Chain | Dependências vulneráveis e execução em ambiente não confiável | OWASP A06 / CWE-1395 |

## Evidências coletadas

- **Segredos:** Nenhuma chave privada, token de produção ou secret real está versionado; apenas `.env.example` com placeholders. `SUPABASE_SERVICE_ROLE_KEY` é restrito às Edge Functions do servidor.
- **Headers & CSP:** `vercel.json` define CSP estrito (`script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` e `Permissions-Policy`.
- **Sessões:** Clientes `supabase` (interno) e `supabasePortal` (cliente) utilizam `storageKey` distintos (`td-portal-auth`), impedindo cross-session pollution. Portal desativa `detectSessionInUrl`.
- **CORS:** Allowlist explícita de origens; origens não autorizadas recebem a ausência do header CORS (sem reflexão de `null` ou `*`), acompanhado de `Vary: Origin`.
- **Timing Attacks:** Comparações em tempo constante (`timingSafeEqual`) implementadas em webhooks e cron jobs autenticados por bearer secret.
- **Anti-enumeração:** Endpoints públicos de recuperação de senha e ativação respondem payloads genéricos e executam envio de emails via `EdgeRuntime.waitUntil`, eliminando oráculos de tempo.
- **Transacionalidade e Compensações:** Ativação de convites e suspensão de contas aplicam rollback/compensação automática em caso de falha de persistência ou auditoria (`SEC-002` mitigado).
- **Scanner npm:** `npm audit` reportou **0 vulnerabilidades** em 284 pacotes auditados.
- **Linter & Typecheck:** `eslint .` e `tsc -b` executaram com **0 erros** (com `.worktrees/**` isolado).
- **Testes automatizados:** Testes de fronteira e regressão (`portalSecurityRemediation.test.ts`, `portalAuthenticatedBoundaryMigration.test.ts`, etc.) e suíte completa executaram com sucesso.

## Limitações

- Não houve acesso direto ao projeto em produção, ao histórico remoto de migrations no painel Supabase nem a secrets configurados no dashboard de hosting/provedor.
- Não foram disparados emails para clientes reais nem gerados tráfegos destrutivos.
- Avaliação de políticas RLS realizada via análise estática das migrations e testes de contrato SQL.
