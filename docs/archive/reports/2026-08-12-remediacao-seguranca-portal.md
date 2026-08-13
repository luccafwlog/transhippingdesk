# Remediação de segurança do Portal do Cliente — relatório de execução

> Origem: [`docs/archive/audits/security-audit-portal-2026-08-12.md`](../audits/security-audit-portal-2026-08-12.md).
> Plano executado: [`docs/archive/plans/2026-08-12-remediacao-seguranca-portal.md`](../plans/2026-08-12-remediacao-seguranca-portal.md).

## 1. Sumário

O plano de remediação da auditoria de 2026-08-12 foi executado na íntegra,
dentro do mesmo branch/PR que a auditoria. As 4 tasks (1 🔴, 2 🟠, 1 🔵/🟠) estão
concluídas: identidade guardada em `import_manifest_transactional`, resposta
não enumerável em `/portal/esqueci-senha`, token removido da URL/telemetria e
CORS/`anon` fechados em `portal-invite-activate`/`portal_invoice_details`.

## 2. Teste de penetração — antes e depois

Executado contra banco descartável (`scripts/setup-local-pg.sh --reset`), com
replay completo das migrations (incluindo a nova `290`), identidade real de
cliente do Portal e de usuário interno, seguindo o padrão de
`docs/archive/audits/security-audit-portal-2026-08-05.md`. **Runtime**

| # | Objeto | Cliente do Portal — ANTES | Cliente do Portal — DEPOIS |
|---|---|---|---|
| 1 | `import_manifest_transactional` (autoria própria) | executou, retornou `batch_id` | negado `42501` |
| 2 | `portal_invoice_details` (chamado por `anon`) | `28000` (guarda interna alcançada) | `42501 permission denied` (fronteira volta a ser o grant) |

**Não regressão do usuário interno (depois):**
`import_manifest_transactional` com `p_uploaded_by = auth.uid()` de um usuário
interno ativo retornou `batch_id` normalmente. **Runtime**

**Autoria forjada negada (depois):** usuário interno ativo passando
`p_uploaded_by` de outro usuário interno recebeu `42501`. **Runtime**

**Isolamento de faturas (depois):** sessão de cliente do Portal continua
lendo a própria fatura via `portal_invoice_details` e recusando a alheia —
`current_portal_customer_id()` segue como defesa em profundidade mesmo sem o
grant a `anon`. **Runtime**

## 3. Correções aplicadas

### Task 1 — `import_manifest_transactional` (migration `290`)

| Objeto | Antes | Depois |
|---|---|---|
| `import_manifest_transactional(...)` | `SECURITY DEFINER` sem guarda de identidade; `p_uploaded_by` confiado ao chamador | Guarda no topo: `auth.uid() IS NULL OR NOT is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid()` → `42501`; corpo restante idêntico à migration `285` |

Teste de contrato SQL novo:
`src/services/__tests__/importManifestIdentityGuardMigration.test.ts` — trava
a guarda, a revogação de `PUBLIC`/`anon` e o grant a `authenticated`, no
padrão de `portalAuthenticatedBoundaryMigration.test.ts`.

### Task 2 — `/portal/esqueci-senha` não enumerável

`supabase/functions/portal-password-recovery/index.ts` parou de devolver
`{ account_found, email_sent }` distintos por caso; agora devolve
`{ accepted: true }` para todo caso elegível (CNPJ malformado, sem conta,
inativa, email suprimido ou envio concluído) e `{ accepted: false,
rate_limited: true }` apenas quando o rate limit bloqueia. O envio real do
email segue condicionado exatamente como antes.

`src/pages/PortalForgotPassword.tsx` mostra uma única tela de sucesso
("Solicitação recebida") para qualquer desfecho elegível, preservando apenas
a mensagem distinta de rate limit.

Teste atualizado: `src/pages/__tests__/PortalRecovery.behavior.test.tsx` —
cobre o novo contrato, a tela idêntica para conta existente/inexistente e a
mensagem de rate limit.

Latência entre o caminho "sem conta" e o caminho "com conta" não foi medida
neste change — ambos agora fazem trabalho equivalente (rate limit + consulta
de conta) antes de responder, o que reduz a diferença observada na
auditoria, mas não foi objeto de medição formal.

### Task 3 — Token na URL e telemetria

- `src/lib/telemetry.ts`: `beforeSend` agora redige a query string inteira de
  `event.request.url` e do header `Referer` (`redactUrlQueryString`), antes de
  o evento ser enviado. Teste: `src/lib/__tests__/telemetry.test.ts`.
- `src/pages/PortalResetPassword.tsx` e `src/pages/PortalAtivacao.tsx`: o
  token é lido uma vez, mantido em estado do componente e removido da URL com
  `setSearchParams(params, { replace: true })`, espelhando
  `src/pages/PortalProfile.tsx`. Testes: acrescentado a
  `PortalRecovery.behavior.test.tsx` (reset) e novo
  `src/pages/__tests__/PortalAtivacao.test.tsx` (ativação) — ambos confirmam
  URL sem `token` após a montagem e submit funcionando com o valor correto.

### Task 4 — CORS pela allowlist e revogação de `anon`

- `supabase/functions/portal-invite-activate/index.ts` trocou o CORS
  hand-rolled (`Access-Control-Allow-Origin: '*'`) pelo `corsHeaders` de
  `_shared/cors.ts`, no mesmo padrão de `portal-invite-send`.
- Migration `290` também revoga `EXECUTE` de `anon` em
  `portal_invoice_details(bigint)` (achado 3.5), dobrado com a correção da
  Task 1 para não abrir uma segunda migration só para isso.

## 4. Verificação final

```bash
npm run lint        # ok
npm test             # 393 arquivos, 1774 testes, 0 falhas (16 skipped pré-existentes)
npm run build         # ok
npm run docs:check     # 183 arquivos Markdown, 41 rotas, índice de ADR ok
scripts/setup-local-pg.sh --reset   # 290 migrations aplicadas sem erro
```

`npm run test:integration` (Supabase real) não foi executado neste ambiente —
requer credenciais de projeto Supabase indisponíveis no sandbox. O único
caso relevante (`import_manifest_transactional rejeita hash duplicado`,
`src/integration/supabase.integration.test.ts`) autentica como usuário
interno e passa `p_uploaded_by: userId`, que é exatamente o caso 3 (não
regressão) confirmado no banco descartável — condição de STOP do plano não
observada, mas fica pendente de confirmação em CI/staging com o Supabase
real.

## 5. Documentação viva atualizada

- `docs/CHANGELOG.md` — entrada da remediação.
- `docs/modules/portal-cliente.md` — telas `/portal/esqueci-senha` e
  `/portal/recuperar-senha` corrigidas para o fluxo real (Edge Functions com
  token de convite hasheado, não o fluxo antigo de hash do Supabase Auth que
  o texto anterior descrevia), catálogo de ações e nota de cobertura de
  testes atualizados.
- Este relatório, nascido histórico em `docs/archive/reports/`.
- O plano executado movido para `docs/archive/plans/`, linha removida de
  `docs/plans/README.md`.

## 6. Fora de escopo (mantido)

- Advisory HIGH do `react-router` 7.17.0 (achado 3.6) — não tratado, conforme
  decisão registrada na auditoria de origem.
- Remoção de `import_manifest_transactional` — guardada, não aposentada;
  decisão de arquitetura separada.

---

**Remediação concluída em 2026-08-13.** 4 tasks executadas, 2 controles
validados por teste de penetração antes/depois em banco descartável (o guard
de escrita e o grant de `portal_invoice_details`), sem regressão no usuário
interno nem no Portal.
