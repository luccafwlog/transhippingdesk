# Remediação da auditoria de segurança do Portal do Cliente (2026-08-12)

> **Executor instructions**: siga o plano passo a passo. Rode cada comando de
> verificação e confirme o resultado esperado antes de avançar. Se alguma
> condição de STOP ocorrer, pare e reporte — não improvise. Ao concluir todas as
> tasks, mova este arquivo para `docs/archive/plans/` e remova a linha da tabela
> em `docs/plans/README.md`, no mesmo change.
>
> **Drift check (rodar primeiro)**:
> `git diff --stat b1cb778..HEAD -- supabase/migrations/ supabase/functions/portal-invite-activate/ src/lib/telemetry.ts src/pages/PortalForgotPassword.tsx src/pages/PortalResetPassword.tsx src/pages/PortalAtivacao.tsx`
> Se algum arquivo em escopo mudou desde a escrita deste plano, compare os
> trechos de "Estado atual" com o código vivo antes de prosseguir; divergência é
> condição de STOP.

## Status

- **Priority**: P1 (a Task 1 é P0)
- **Effort**: M
- **Risk**: MED (migration em RPC transacional; mudança de comportamento visível
  numa tela pública do Portal)
- **Depends on**: nenhuma
- **Category**: security
- **Origem**: [`docs/archive/audits/security-audit-portal-2026-08-12.md`](../archive/audits/security-audit-portal-2026-08-12.md)

## Contexto

A auditoria de 2026-08-12 encontrou 6 achados no Portal do Cliente. O usuário
aprovou o levantamento e pediu **plano sem execução**; este documento é esse
plano. O achado 3.6 (advisory do `react-router`) está deliberadamente **fora de
escopo** — o bump atinge todas as rotas do app e pede frente própria com
regressão de rotas.

A raiz sistêmica é a mesma da migration `257`: o cliente do Portal autentica com
o **mesmo role `authenticated`** do usuário interno. Quem separa os dois é o
perfil (`user_profiles` para interno, `customer_portal_accounts` para cliente).
Toda função `SECURITY DEFINER` sem guarda por perfil é alcançável pelo cliente.

**Leitura obrigatória antes de começar:**
[`docs/adr/0004`](../adr/0004-supabase-rls-rpc-fronteira-seguranca.md),
[`docs/adr/0011`](../adr/0011-revogacao-anon-security-definer-default-deny.md),
[`docs/adr/0013`](../adr/0013-portal-auth-identificador-resolvido-e-excecao-anon.md),
`skills/supabase-migration` e o relatório de origem.

## Preparação

```bash
scripts/setup-local-pg.sh --reset   # replay das migrations em banco descartável
export PGPASSWORD=postgres
```

A identidade de ataque usada em todas as verificações deste plano:

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub  TO '<auth_user_id de uma customer_portal_accounts ativa>';
SET LOCAL request.jwt.claim.role TO 'authenticated';
-- ... chamada sob teste ...
ROLLBACK;
```

Confirme antes de testar: `is_active_read_user()`, `is_active_user()` e
`is_admin()` devem retornar `false`, e `current_portal_customer_id()` deve
resolver para o `customer_id` da conta.

---

## Task 1 — 🔴 Guarda de identidade em `import_manifest_transactional`

**Achado 3.1.** Uma sessão de cliente do Portal cria `import_batches` e `bls` em
viagem arbitrária, com autoria (`p_uploaded_by`) de sua escolha; com
`p_apply_overwrites = true` também sobrescreve B/Ls de outros clientes.

**Estado atual:** a função pública (migration `285`) delega a
`import_manifest_transactional_legacy_165`, e **nenhuma das duas** verifica
identidade. Os únicos controles do núcleo são um rate limit por `p_uploaded_by`
— fornecido pelo chamador — e a existência da viagem.

**Correção:** guarda no mesmo formato dos irmãos
(`import_bl_freight_transactional_legacy_205`,
`save_granite_bl_review_legacy_148`), aplicada na **função pública**. O núcleo
`legacy_165` já está revogado de `PUBLIC`, `anon` e `authenticated` e não é
alcançável; recriá-lo só para guardar aumentaria a superfície de mudança sem
ganho.

Criar `supabase/migrations/290_import_manifest_identity_guard.sql`:

```sql
-- 290: Fecha a escrita global de import_manifest_transactional encontrada na
-- auditoria de seguranca de 2026-08-12 (docs/archive/audits/).
--
-- Raiz herdada da migration 257: o cliente do Portal recebe o MESMO role
-- `authenticated` do usuario interno. A funcao era SECURITY DEFINER com EXECUTE
-- para authenticated e sem nenhuma guarda -- uma sessao de cliente criava
-- import_batches e bls em viagem arbitraria, com autoria escolhida por ela.
--
-- A guarda e a mesma dos irmaos (legacy_205, legacy_148): exige sessao interna
-- ativa E amarra o parametro de autoria a auth.uid(), porque p_uploaded_by vem
-- do chamador e e o que ancora o rate limit e a trilha de auditoria.
--
-- Rollback: remover a guarda reabre a escrita global; nao fazer sem controle
-- equivalente.
CREATE OR REPLACE FUNCTION public.import_manifest_transactional(
  p_filename TEXT, p_voyage_id BIGINT, p_uploaded_by UUID, p_cargo_mode TEXT,
  p_file_hash TEXT, p_total_bls INTEGER, p_total_containers INTEGER,
  p_bls JSONB, p_containers JSONB, p_errors JSONB,
  p_apply_overwrites BOOLEAN DEFAULT FALSE
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result BIGINT;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar manifesto.'
      USING ERRCODE = '42501';
  END IF;

  -- (corpo restante identico ao da migration 285: chamada ao legacy_165 e
  -- UPDATE de suggested_customer_id / customer_reconciliation_status)
  ...
END;
$function$;

REVOKE ALL ON FUNCTION public.import_manifest_transactional(
  TEXT, BIGINT, UUID, TEXT, TEXT, INTEGER, INTEGER, JSONB, JSONB, JSONB, BOOLEAN
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_manifest_transactional(
  TEXT, BIGINT, UUID, TEXT, TEXT, INTEGER, INTEGER, JSONB, JSONB, JSONB, BOOLEAN
) TO authenticated;
```

**Copiar o corpo da migration `285` literalmente** — este plano não o reproduz
para não introduzir divergência. A única adição é o bloco de guarda no topo.

**Verificação:**

1. Replay limpo: `scripts/setup-local-pg.sh --reset` termina sem erro.
2. Ataque **negado**: a chamada com a identidade do cliente do Portal retorna
   `42501`, e `import_batches`/`bls` não ganham linhas (conferir com a sessão
   restaurada dentro da mesma transação, antes do `ROLLBACK`).
3. Não regressão interna: a mesma chamada com um `auth.uid()` de `user_profiles`
   ativo, passando `p_uploaded_by = auth.uid()`, retorna `batch_id`.
4. Autoria forjada negada: usuário interno ativo passando `p_uploaded_by` de
   **outro** usuário recebe `42501`.
5. Teste de contrato SQL novo em
   `src/services/__tests__/importManifestIdentityGuardMigration.test.ts`, no
   padrão de `portalAuthenticatedBoundaryMigration.test.ts`: a migration contém
   a guarda, revoga `anon` e não concede `EXECUTE` a `anon`.

**STOP** se o teste de integração `supabase.integration.test.ts` passar a falhar
com `42501`: ele autentica como usuário interno e passa `p_uploaded_by = userId`,
então isso indicaria que a guarda está errada, não o teste.

---

## Task 2 — 🟠 Resposta não enumerável em `/portal/esqueci-senha`

**Achado 3.2.** A tela revela se o CNPJ tem conta no Portal; o rate limit é por
CNPJ e não custa nada varrer CNPJs distintos.

**Estado atual:** `supabase/functions/portal-password-recovery/index.ts` devolve
`{ account_found, email_sent }` e `src/pages/PortalForgotPassword.tsx` traduz
cada combinação numa mensagem distinta ("Não existe uma conta...", "Conta
encontrada", "Existe uma conta vinculada, mas...").

**Contrato a restaurar:** `docs/RASTREABILIDADE.md` linha 34 ("resposta
permanece genérica") e `docs/modules/portal-cliente.md` linha 122 ("Mantém
resposta não enumerável"). O código é que divergiu.

**Correção:**

1. `PortalForgotPassword.tsx`: uma única tela de sucesso para qualquer desfecho
   elegível — *"Se houver uma conta do Portal para este CNPJ, enviamos um link
   de redefinição ao email cadastrado."* Preservar apenas a mensagem de
   **rate limit** (`account_found === null`), que não distingue conta e é
   informação útil de "tente mais tarde".
2. Edge Function: parar de devolver `account_found`/`email_sent` distintos.
   Devolver `{ accepted: true }` para todo caso elegível e manter o sinal
   separado apenas para o bloqueio por rate limit. O envio real do email segue
   condicionado como hoje (conta ativa, `recovery_email` presente, não
   suprimido).
3. Latência: hoje o caminho "sem conta" retorna antes de qualquer trabalho.
   Se a diferença for grande o bastante para virar oráculo de tempo, registrar
   como **Suspeita** na nota do módulo em vez de improvisar mitigação — medir
   antes de tratar.

**Verificação:**

1. Atualizar `src/pages/__tests__/PortalRecovery.behavior.test.tsx`: a tela
   mostra a **mesma** mensagem para conta existente e inexistente.
2. Teste novo: `account_found: false` e `account_found: true` produzem texto
   idêntico na tela.
3. `docs/operations/validacao.md` linha 366 ("confirme resposta que não enumera
   conta") volta a ser executável — conferir manualmente.

**Doc viva a atualizar:** nenhuma mudança de texto necessária em
`RASTREABILIDADE.md` nem em `portal-cliente.md` (o código passa a cumprir o que
já está escrito); registrar a correção em `docs/CHANGELOG.md`.

---

## Task 3 — 🟠 Higienizar token na URL e na telemetria

**Achado 3.3.** `httpContextIntegration` (default do `@sentry/browser`) grava
`event.request.url = location.href` no `preprocessEvent`, que roda **antes** do
`beforeSend`; o `beforeSend` do projeto não toca em `request.url`. Erro na
página com `?token=` envia o token vivo ao Sentry.

**Correção — duas camadas independentes, aplicar as duas:**

1. `src/lib/telemetry.ts`: no `beforeSend`, redigir a query string de
   `event.request.url` (e do header `Referer`, que carrega o mesmo risco quando
   a navegação parte da tela do token). Preferir redigir a query **inteira** a
   manter uma lista de nomes de parâmetro sensíveis — lista de nomes envelhece
   mal, e nenhuma query do Portal é necessária para diagnóstico.
2. `src/pages/PortalResetPassword.tsx` e `src/pages/PortalAtivacao.tsx`: após
   ler o token, removê-lo da URL com
   `setSearchParams(params, { replace: true })`, mantendo-o em estado do
   componente para o submit. Espelhar `src/pages/PortalProfile.tsx`, que já faz
   exatamente isso com `?confirm_email=`.

**Verificação:**

1. Teste unitário do `beforeSend`: evento com
   `request.url = 'https://portal…/portal/recuperar-senha?token=SEGREDO'` sai
   sem `SEGREDO`.
2. Teste de comportamento das duas telas: após a montagem, a URL não contém mais
   `token`, e o submit continua enviando o token correto à Edge Function.
3. `PortalProfile` permanece verde (não regredir o precedente).

---

## Task 4 — 🔵 CORS pela allowlist e revogação de `anon`

Dois ajustes pequenos, sem mudança de comportamento legítimo.

**4a — Achado 3.4.** `supabase/functions/portal-invite-activate/index.ts` monta
`'Access-Control-Allow-Origin': '*'` à mão. Trocar pelo `withCors`/`corsHeaders`
de `_shared/cors.ts`, como todas as outras Edge Functions do Portal. Manter os
mesmos status e corpos de resposta.

**4b — Achado 3.5.** A migration `261` concedeu
`portal_invoice_details(bigint)` a `anon`, fora da allowlist da ADR 0013.
Acrescentar à migration da Task 1 (ou a uma `291` própria, se a Task 1 for
adiada):

```sql
REVOKE EXECUTE ON FUNCTION public.portal_invoice_details(BIGINT) FROM anon;
```

Não tocar no corpo: a guarda `current_portal_customer_id()` já lança `28000`
para `anon` e continua sendo a defesa em profundidade.

**Verificação:**

1. `anon` chamando `portal_invoice_details` passa de `28000` para
   `42501 permission denied` — a fronteira volta a ser o grant.
2. Sessão de cliente do Portal continua lendo a **própria** fatura e recusando a
   alheia (controle positivo e negativo da premissa 2).
3. Ativação por convite continua funcionando a partir de uma origem da
   allowlist; origem fora da lista recebe `null`.

---

## Verificação final (antes do PR)

```bash
npm run lint
npm test
npm run build
npm run docs:check
scripts/setup-local-pg.sh --reset    # replay das migrations do zero
```

Repetir a bateria de penetração da seção 4 do relatório e preencher a coluna
"depois" — o relatório de 2026-08-05 é o modelo de tabela antes/depois. Como o
relatório de 2026-08-12 é **histórico** e não pode ser editado, o resultado da
remediação vai num relatório de execução novo em `docs/archive/reports/`, que
referencia a auditoria de origem.

## Documentação viva a atualizar no mesmo change

- `docs/CHANGELOG.md` — entrada da remediação.
- `docs/RASTREABILIDADE.md` — linha das Edge Functions do Portal, se o contrato
  de resposta de `portal-password-recovery` mudar de forma observável.
- `docs/modules/portal-cliente.md` — nota sobre token removido da URL e sobre a
  resposta não enumerável restaurada.
- Este plano → `docs/archive/plans/`, com a linha removida de
  `docs/plans/README.md`.

## STOP conditions

- Replay das migrations falha em banco limpo.
- O teste de integração `import_manifest_transactional` passa a receber `42501`
  com usuário interno legítimo.
- Alguma RPC de leitura do Portal (`portal_list_invoices`,
  `portal_list_operation_bls`, `portal_list_demurrage_invoices`,
  `portal_list_consolidatable_receivables`, `portal_get_session_overview_v2`)
  regride para a sessão do cliente.
- A ativação por convite deixa de funcionar a partir de uma origem da allowlist.

## Fora de escopo

- **Advisory HIGH do `react-router` 7.17.0** (achado 3.6): frente própria com
  regressão de rotas. Das cinco advisories, três são de SSR/RSC e não se aplicam
  a este SPA; restam o open redirect por contrabarra e o DoS por casamento de
  rotas.
- Remover `import_manifest_transactional`, que não tem chamador em produção
  desde a ADR 0025. Guardar primeiro é a correção de segurança; aposentar a
  função é decisão de arquitetura, com sua própria discussão.
