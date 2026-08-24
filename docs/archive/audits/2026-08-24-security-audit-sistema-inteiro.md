# Auditoria de segurança do sistema inteiro

Data: 2026-08-24
Escopo: repositório local completo `transhippingdesk`
Método: análise estática de código, scan de dependências (CVE), testes de contrato SQL/Auth, inspeção de cabeçalhos e verificação de build/lint.

## Resumo executivo

A auditoria de segurança em todo o sistema realizada em **2026-08-24** confirmou que a postura defensiva do projeto é robusta e está em conformidade com as diretrizes OWASP Top 10, CWE Top 25 e boas práticas para aplicações SaaS com Supabase e Vercel.

Não foram encontradas vulnerabilidades ativas, segredos versionados, injeções de SQL, quebras de autenticação ou brechas de RLS. Os achados identificados em ciclos anteriores (dependências vulneráveis, transacionalidade em funções administrativas/Portal e escopo de linter) encontram-se **100% mitigados e cobertos por testes automatizados**.

| Área Avaliada | Status | Observação |
|---|---|---|
| Autenticação & Sessões | ✅ Seguro | Clientes interno e Portal isolados (`storageKey`), sem detecção de sessão em URL no Portal, taxa de tentativas limitada por CNPJ, tokens com SHA-256 |
| Autorização & RLS | ✅ Seguro | 340 migrations validadas; nenhuma policy viva concede acesso irrestrito `USING (true)` para dados sensíveis |
| Edge Functions & Privilégios | ✅ Seguro | RPCs `SECURITY DEFINER` com `search_path` fixo; transações com compensação/rollback em falha de escrita |
| Cabeçalhos & Web Security | ✅ Seguro | CSP estrito em `vercel.json`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, CORS com allowlist exata |
| Integridade & Webhooks | ✅ Seguro | Assinaturas Svix validadas com tolerância de timestamp; segredos comparados em tempo constante (`timingSafeEqual`) |
| Frontend & Injeções | ✅ Seguro | Zero `dangerouslySetInnerHTML`, zero `eval()`, queries parametrizadas via PostgREST |
| Telemetria & Privacidade | ✅ Seguro | Redação de PII (CNPJ, CPF, Email) e sanitização de query strings em rotas de convite/reset |
| Dependências (Supply Chain) | ✅ Seguro | `npm audit` reporta 0 vulnerabilidades |

---

## Detalhamento dos Domínios Auditados

### 1. Autenticação e Gestão de Sessão (OWASP A07 / CWE-307)
- **Separação de Clientes:** O aplicativo frontend inicializa duas instâncias independentes do cliente Supabase (`supabase` e `supabasePortal` em `src/services/supabase.ts`), garantindo que a sessão do cliente do Portal não compartilhe nem interfira com a sessão do operador interno.
- **Política de Senhas:** Validação idêntica e estrita no frontend (`src/lib/passwordPolicy.ts`), Edge Functions (`supabase/functions/_shared/passwordPolicy.ts`) e banco de dados, exigindo no mínimo 8 caracteres com combinação de maiúsculas, minúsculas e números.
- **Revogação de Sessão:** Ao trocar de senha, suspender usuário ou confirmar alteração de e-mail de recuperação, as sessões ativas são revogadas (`revokePortalSessions` / `admin.auth.admin.signOut`).
- **Geração e Armazenamento de Tokens:** Tokens de ativação e recuperação utilizam 32 bytes de entropia criptográfica (`crypto.getRandomValues`) e são persistidos no banco de dados exclusivamente na forma de hash SHA-256 (`token_hash`).
- **Prevenção de Enumeração e Timing Attacks:** O fluxo de recuperação de senha devolve payload uniforme `{ accepted: true }` mesmo para CNPJs não cadastrados e executa disparos de email de forma assíncrona (`EdgeRuntime.waitUntil`), neutralizando oráculos temporais.

### 2. Autorização e Controle de Acesso - RLS & RPCs (OWASP A01 / CWE-862)
- **Isolamento de Papéis:** As políticas de RLS e RPCs diferenciam perfis de usuários internos (`user_profiles.role` via `is_active_read_user()` / `is_admin()`) de clientes externos (`customer_portal_accounts` via `current_portal_customer_id()`).
- **Auditoria de Policies:** Teste de contrato automatizado (`portalAuthenticatedBoundaryMigration.test.ts`) valida estaticamente todas as migrations ativas, assegurando que o role `authenticated` não receba permissões implícitas através de `USING (true)`.
- **Search Path em Funções Privilegiadas:** Funções `SECURITY DEFINER` possuem `SET search_path = public, pg_temp` ou equivalente para prevenir sequestro de caminho de execução por objetos em schemas mutáveis.

### 3. Edge Functions e Transacionalidade (OWASP A04 / A05)
- **Tratamento de Falhas e Compensação:** Conforme validado em `portalSecurityRemediation.test.ts`, operações de convite e ativação (`portal-invite-activate`) ou suspensão (`portal-account-suspend`) executam rollback e limpeza em caso de falha intermediária (ex.: se a inserção no perfil falhar, o usuário Auth criado é imediatamente deletado, evitando estados órfãos).
- **Proteção de Cron Jobs e Webhooks Internos:** Endpoints invocados por `pg_cron` / `pg_net` (`alerts-detector`, `recalc-demurrage-ptax`) validam segredos dedicados utilizando comparação de strings em tempo constante (`timingSafeEqual`), mitigando ataques de temporização.

### 4. Proteção de Comunicações, CORS e Cabeçalhos HTTP (OWASP A05)
- **Configuração CORS:** Implementação em `supabase/functions/_shared/cors.ts` mantém allowlist explícita (`ALLOWED_ORIGINS`). Requisições com origens não autorizadas recebem a ausência do cabeçalho `Access-Control-Allow-Origin` (sem reflexão de `null` ou `*`), acompanhadas do cabeçalho `Vary: Origin`.
- **Cabeçalhos de Segurança (Vercel):** Configuração em `vercel.json` inclui:
  - `Content-Security-Policy`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://olinda.bcb.gov.br https://*.ingest.us.sentry.io; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`

### 5. Proteção de Dados e Telemetria (OWASP A09 / CWE-532)
- **Scrubbing de PII:** `src/lib/telemetry.ts` intercepta exceções e breadcrumbs antes do envio ao Sentry e Vercel Analytics, aplicando substituições com regex para padrões de CNPJ, CPF e endereços de email.
- **Redação de Tokens em URLs:** Parâmetros de query string (incluindo tokens de recuperação e ativação) são completamente removidos antes do encaminhamento de métricas e rastreamentos.

---

## Validação e Evidências Técnicas

| Verificação | Comando | Resultado |
|---|---|---|
| Integridade Documental | `npm run docs:check` | ✅ Passou (195 Markdown, 47 rotas, índice de ADRs) |
| Tipagem Estática | `npx tsc --noEmit` / `tsc -b` | ✅ Passou (0 erros de tipagem) |
| Análise de Código (Linter) | `npx eslint src` | ✅ Passou (0 warnings / 0 errors) |
| Segurança de Dependências | `npm audit` | ✅ Passou (0 vulnerabilidades em 284 pacotes) |
| Teste de Fronteira RLS | `npx vitest run .../portalAuthenticatedBoundaryMigration.test.ts` | ✅ Passou (8/8 testes) |
| Teste de Compensação Auth | `npx vitest run .../portalSecurityRemediation.test.ts` | ✅ Passou (2/2 testes) |
| Suíte de Testes Unitários | `npm test` | ✅ Passou (2.293 testes aprovados) |
| Build de Produção | `npm run build` | ✅ Passou (Assets gerados em 26s) |

---

## Conclusão e Recomendações

O sistema encontra-se em estado de segurança validado para operação. Recomenda-se manter o fluxo de CI existente com os gates obrigatórios de `docs:check`, `lint`, `typecheck`, `test` e `audit` em cada pull request.
