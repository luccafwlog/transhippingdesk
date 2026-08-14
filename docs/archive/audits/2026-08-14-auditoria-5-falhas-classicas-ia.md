# Auditoria de segurança — as 5 falhas clássicas de aplicações geradas por IA (2026-08-14)

Snapshot datado. Registro histórico do estado do código em 2026-08-14. Auditoria
somente de leitura: **nenhum arquivo de aplicação, migration ou Edge Function foi
alterado** nesta mudança.

> **Nota editorial (2026-08-14, revisão do autor).** A varredura original rodou
> sobre uma árvore anterior ao merge da migration `295_internal_writes_global.sql`
> (PR #533) e classificou A-01 como Média, tratando a ausência de fronteira
> departamental de escrita como lacuna. Ela é decisão deliberada: a `295` desmontou
> os `can_edit_*`, e `CONTEXT.md` a registra como "Escrita interna global". A-01 foi
> reescrito e rebaixado a Informativo. A-02 foi rebaixado na mesma revisão: a
> exposição pública da programação de navios é intencional e passou a ser exceção
> pré-autenticação documentada em `docs/ARCHITECTURE.md`. **Nenhum achado de
> severidade Média permanece.**

## Propósito e escopo

Verificar, direto do código, se o Transhipping Desk incorre em cada uma das cinco
falhas clássicas de aplicações geradas por IA:

1. RLS / banco exposto;
2. confiança cega no front-end para privilégios;
3. IDOR (autorização por objeto);
4. chaves e segredos expostos;
5. inputs sem sanitização (XSS / upload).

Superfície coberta: `supabase/migrations/` (293 arquivos), `supabase/functions/`
(11 funções + `_shared`), `supabase/config.toml`, `src/` inteiro, `firebase.json`,
`vite.config.ts`, `.github/workflows/`, `scripts/`.

## Veredito executivo

O projeto **não** apresenta nenhuma das cinco falhas na forma clássica. As três
que mais derrubam aplicações geradas por IA — RLS desligada, autorização só no
front-end e segredo no bundle — estão fechadas, e o fechamento é rastreável em
migrations dedicadas (`010`, `042`, `077`, `091`, `141`, `211`, `215`, `257`,
`291`, `292`).

O que sobra são **8 achados residuais**, nenhum crítico e **nenhum de severidade
média**: três baixos (A-03, A-04, A-05) e cinco informativos, dois dos quais
(A-01 e A-02) são decisões de projeto registradas, não defeitos.

| # | Achado | Classe | Severidade |
|---|---|---|---|
| A-01 | Escrita interna é global por decisão (`295`); a fronteira departamental é de UI | 2 | Informativo |
| A-02 | `portal_ship_schedule()` concedida a `anon` — vitrine pública intencional | 1 / 3 | Informativo |
| A-03 | Funções `*_legacy` renomeadas mantêm o ACL antigo (`anon`) | 1 | Baixa |
| A-04 | Política de senha do Portal mais fraca que a interna | 4 | Baixa |
| A-05 | CORS devolve `Access-Control-Allow-Origin: null` para origem negada | — | Baixa |
| A-06 | `ALTER DEFAULT PRIVILEGES` deixa o schema aberto por padrão | 1 | Informativo |
| A-07 | Um leitor de planilha sem `assertUploadSize` | 5 | Informativo |
| A-08 | Segredo de desenvolvimento hardcoded e secret interpolado no shell do CI | 4 | Informativo |

---

## 1. RLS / banco exposto — **não confirmado**

### O que foi verificado

- **Cobertura de RLS:** as 84 tabelas de `public` têm `ENABLE ROW LEVEL SECURITY`.
  As 20 tabelas de `001_schema.sql` que não têm `ALTER TABLE ... ENABLE` estático
  são ligadas pelo laço dinâmico de `002_rls.sql:28-30`; as demais têm o `ALTER`
  explícito na própria migration de criação.
- **Policies permissivas:** varredura do estado final de todas as `CREATE POLICY`
  (estáticas e dinâmicas) não encontrou nenhuma policy viva com `USING (true)` ou
  `USING (auth.role() = 'authenticated')`. As que existiram foram substituídas:
  `004`/`006` por `010_rls_by_role.sql:112-124`; `034`/`035` (granito e vazios)
  por `042_rls_module_hardening.sql:69-101` e `:130-160`; `055`/`056`/`059` por
  `091_harden_remaining_permissive_rls.sql`; `153` por `160`; `167` por `170`;
  `124` (`vessel_schedules`, `ended_vessels`) por
  `257_portal_authenticated_boundary_hardening.sql:88`.
- **Views:** o schema não tem nenhuma `CREATE VIEW`. Isso elimina de saída a
  armadilha do Supabase de view sem `security_invoker` furando a RLS da tabela-base.
- **SQL dinâmico:** nenhuma função com parâmetro `p_*` monta SQL por concatenação
  ou `format('%s')`. Não há superfície de SQL injection em RPC.
- **Acesso direto do front-end:** o front-end fala com PostgREST com a `anon key`,
  mas toda tabela é filtrada por `is_active_read_user()`, `is_active_user()`,
  `is_admin()` ou um `can_edit_*()` — helpers que consultam `user_profiles`. O
  cliente do Portal recebe o mesmo role `authenticated` do usuário interno mas
  **não tem linha em `user_profiles`**, então falha em todos eles.

### A-01 — Escrita interna é global por decisão; Departamento é fronteira de UI (Informativo)

**Reclassificado.** A redação abaixo é a da varredura original, feita sobre a
árvore anterior à migration `295_internal_writes_global.sql` (PR #533). Ela
descreve corretamente o **mecanismo** — `is_active_user()` não separa Financeiro
de Operações de Documentação — mas erra o **julgamento**: isso não é lacuna, é o
modelo escolhido. A `295` desmontou os `can_edit_*` de propósito ("remove a
barreira departamental de escrita interna", linha 1), preservando apenas três
exceções: exclusão de registro operacional, provisionamento do Portal e
administração de usuários. `CONTEXT.md` registra o termo **Escrita interna
global** e define Departamento como "assinatura de responsabilidade… não delimita
acesso"; o controle compensatório é o **Rastro obrigatório**, que congela autor e
Departamento em cada evento.

Portanto: a correção sugerida no fim desta seção (criar `can_edit_manifests()`,
`can_edit_demurrage()`, `can_edit_granite()`, `can_edit_vazios()`) **não deve ser
executada** — ela reverteria uma decisão recente. O que se preserva do achado é o
mapa de superfície: quem tem sessão interna ativa escreve em todos os módulos, e
a defesa é rastro e auditoria, não bloqueio prévio.

<details>
<summary>Redação original da varredura (pré-`295`), mantida como registro</summary>


**Arquivos:** `src/hooks/useAuth.tsx:29-50` × `supabase/migrations/010_rls_by_role.sql:128-145`,
`supabase/migrations/042_rls_module_hardening.sql:69-101`,
`supabase/migrations/050_alignment_granite_portal_demurrage.sql:299-305`

`roleHasPermission()` define 14 permissões granulares por setor. O banco, porém,
só distingue **cinco** contratos: `is_admin()`, `is_active_user()` (ativo, exceto
Equipamentos), `is_active_read_user()` (todo ativo), `is_equipamentos_user()` e os
quatro helpers de escrita criados sob demanda — `can_edit_voyages()` (215),
`can_edit_customers()` (215), `can_edit_depots()` (230) e `can_edit_local_charges()`
(291).

Onde não existe helper, a escrita cai em `is_active_user()`, que **não separa
Financeiro de Operações de Documentação**. Consequência concreta, verificável do
console do navegador com a sessão de um usuário `financeiro` (que na UI só tem
`reconciliacao_edit`):

| Alvo | Permissão na UI | Predicado real de INSERT/UPDATE | Quem escreve de fato |
|---|---|---|---|
| `bls`, `bl_containers` | `manifests_upload` (administrativo, documentação) | `is_active_user()` | + financeiro, operações |
| `demurrage_invoices`, `demurrage_invoice_items` | `demurrage_edit` (administrativo, documentação) | `is_active_user()` | + financeiro, operações |
| `granite_bls`, `granite_manifests`, `granite_rates`, `granite_bl_charges` | fluxo de Granito (documentação) | `is_active_user()` | + financeiro, operações |
| `vazios_manifests`, `vazios_bookings`, `vazios_importacao_*` | `vazios_edit` | `is_active_user()` | + financeiro, operações |
| `alerts`, `import_batches`, `carriers`, `vessels`, `ports` | — | `is_active_user()` | todo interno não-Equipamentos |

Não há trigger de departamento em `bls` nem em `demurrage_invoices` que compense
a policy (verificado: os triggers dessas tabelas tratam de `updated_at`, gate de
revisão, emissão de invoice e reabertura de pendência — nenhum de autorização).

**Por que é perigoso aqui:** não é escalada para fora da empresa — exige sessão
interna válida — mas quebra o menor privilégio exatamente onde o dado é
financeiro. Um usuário de Financeiro pode reescrever B/L e faturas de demurrage
sem passar por nenhuma tela que a UI mostre a ele, e o `AGENTS.md`/`CONTEXT.md`
descrevem essa separação como se ela existisse. É a mesma classe de achado que a
migration `215` fechou para Viagens/Clientes e a `291` para Taxas Locais — o
padrão está estabelecido, só não foi estendido a estes cinco módulos.

**Correção sugerida:** criar `can_edit_manifests()`, `can_edit_demurrage()`,
`can_edit_granite()` e `can_edit_vazios()` espelhando `roleHasPermission`, no
molde de `215_rbac_voyages_customers_writes.sql`, e aplicá-los ao
`INSERT`/`UPDATE`/`DELETE` das tabelas acima.

</details>

### A-02 — `portal_ship_schedule()` concedida a `anon` — vitrine pública (Informativo)

**Reclassificado de Baixa para Informativo.** A varredura tratou o grant a `anon`
como resíduo; ele é intencional. A programação de navios (navio, viagem, portos,
ETA/ETD/ATA/ATD) é informação de vitrine, do mesmo tipo que armadores publicam
abertamente, e o grant permanece para que ela possa ser servida numa página aberta.
A decisão passou a constar em `docs/ARCHITECTURE.md` como **segunda exceção
pré-autenticação** de `anon`, ao lado de `portal_resolve_login` (ADR 0013).

**Fronteira que a decisão impõe:** `portal_ship_schedule()` não pode ganhar
nenhuma coluna de cliente, fatura, B/L, container ou contato sem revisar esta
exceção. Ela é pública, e qualquer campo acrescentado é publicado junto.

<details>
<summary>Redação original da varredura, mantida como registro</summary>


**Arquivo:** `supabase/migrations/277_portal_schedule_actual_dates.sql:92`
(repetindo `173:76` e `175:80`)

```sql
GRANT EXECUTE ON FUNCTION public.portal_ship_schedule() TO anon, authenticated;
```

O único consumidor é `src/services/portalScheduleVoyages.ts:68`, chamado pelo
widget do Dashboard do Portal — que já está atrás de `PortalProtectedRoute`. O
grant a `anon` não é usado por ninguém.

**Por que é perigoso:** a `anon key` está no bundle público por design. Com ela,
qualquer pessoa faz `POST /rest/v1/rpc/portal_ship_schedule` sem login e obtém a
programação de navios ativos (navio, viagem, portos, ETA/ETD/ATA/ATD). É
inteligência comercial da operação entregue sem autenticação, e contradiz o
contrato documentado em `docs/ARCHITECTURE.md` ("`anon` segue default-deny,
exceto funções pré-autenticação documentadas"): a única exceção documentada é
`portal_resolve_login` (ADR 0013).

**Correção sugerida:** `REVOKE ... FROM anon`, mantendo `authenticated`. Se a
vitrine pública for intencional, documentá-la como segunda exceção pré-auth em
`docs/ARCHITECTURE.md` e no índice de ADRs.

</details>

### A-03 — Funções `*_legacy` renomeadas mantêm o ACL antigo (Baixa)

**Arquivo:** `supabase/migrations/292_portal_inspection.sql:126-127, 154-155, 168-169, 246-247`

`ALTER FUNCTION ... RENAME TO` **preserva o ACL** da função. A migration `292`
renomeia 12 RPCs do Portal para `*_legacy` e revoga apenas os nomes que casam com
`portal_inspect_%` ou `_portal_%_core` (bloco `DO $grants$`, linhas 253-259). Os
`_legacy` ficam de fora e herdam o `GRANT ... TO authenticated, anon` que vinha
de `084`/`105`/`120`/`123`:

- `portal_list_invoices_legacy()`, `portal_invoice_details_legacy(bigint)`,
  `portal_list_demurrage_invoices_legacy()`,
  `portal_get_demurrage_invoice_detail_legacy(bigint)`,
  `portal_list_consolidatable_receivables_legacy()`, `portal_get_profile_legacy()`,
  `portal_list_notifications_legacy(integer)`,
  `portal_notification_unread_count_legacy()`, `portal_get_current_roe_legacy()`,
  `portal_list_operation_bls_legacy()`,
  `portal_list_operation_bls_without_transshipment_legacy()`;
- `portal_list_provisioning_console_legacy(bigint)` e
  `portal_list_provisioning_events_legacy(bigint,integer)`.

**Impacto real: nenhum vazamento hoje.** Todos resolvem o cliente por
`current_portal_customer_id()` (que devolve `NULL` para `anon`) ou checam
`user_profiles` internamente — devolvem vazio ou erro. O problema é de
superfície: são 13 RPCs vivas, publicadas em PostgREST, alcançáveis por `anon`,
fora de qualquer teste e fora da documentação. É exatamente o tipo de resíduo que
vira vulnerabilidade quando alguém "reaproveita" a função legada mais tarde. Note
que a `286` aplicou a disciplina certa no caso análogo
(`save_granite_bl_review_legacy_148`, linha 80: `REVOKE ... FROM PUBLIC, anon, authenticated`).

**Correção sugerida:** `REVOKE ALL ... FROM PUBLIC, anon, authenticated` em todas
as `*_legacy`, ou removê-las quando o rollback da `292` não for mais necessário.

### A-06 — `ALTER DEFAULT PRIVILEGES` deixa o schema aberto por padrão (Informativo)

**Evidência:** `supabase/migrations/041_rls_missing_tables.sql:4`,
`supabase/migrations/257_portal_authenticated_boundary_hardening.sql:47` e o
contrato de teste `src/services/__tests__/portalAuthenticatedBoundaryMigration.test.ts:60-63`
("O projeto tem `ALTER DEFAULT PRIVILEGES` concedendo EXECUTE a `anon` e
`authenticated` em toda função nova de `public`. Revogar só `PUBLIC` não basta").

Toda função nova nasce executável por `anon` e `authenticated`. A segurança
depende de o autor lembrar do `REVOKE`. Hoje 12 funções `SECURITY DEFINER` estão
nesse estado sem revoke explícito — mas **todas são funções de trigger**
(`RETURNS trigger`), e o Postgres rejeita a chamada direta ("trigger functions can
only be called as triggers"). Impacto prático hoje: zero.

O que preocupa é o modo de falha: **aberto por padrão**. Foi ele que gerou as
migrations corretivas `078`, `088`, `093`, `152` e `257` — cinco correções da
mesma causa. Vale inverter o default (`ALTER DEFAULT PRIVILEGES IN SCHEMA public
REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated`) e passar a conceder caso a
caso, tornando o esquecimento um erro fechado em vez de aberto.

---

## 2. Confiança cega no front-end — **não confirmado**

- `localStorage`/`sessionStorage`/`cookies` **não guardam nenhuma flag de
  permissão**. Os únicos usos são: tema visual (`src/hooks/useVisualTheme.ts:21`),
  cache de cotação ROE (`src/services/demurrage/demurrageKpis.ts:241`), retry de
  chunk de rota (`src/lib/lazyPage.ts:17`) e as sessões do próprio supabase-js
  (`src/services/supabase.ts`, com `storageKey: 'td-portal-auth'` separando Portal
  de interno).
- `ProtectedRoute` (`src/components/layout/ProtectedRoute.tsx`) e
  `roleHasPermission` são **navegação e UX**. Mexer em `isAdmin` no devtools libera
  a tela `/admin/usuarios`, mas a Edge Function `admin-users` valida
  `is_admin()` no servidor com o JWT do chamador
  (`supabase/functions/admin-users/index.ts:40-42`) antes de qualquer
  `service_role`, e a RLS de `user_profiles` faz o resto.
- **Escalada de privilégio já fechada:** a policy `user_profiles_self_update`
  (`010_rls_by_role.sql:184`) permitia `PATCH /user_profiles?id=eq.<meu-id>
  {"role":"administrativo"}`. A migration
  `077_fix_user_profile_privilege_escalation.sql` adicionou o trigger
  `trg_prevent_user_profile_privilege_escalation`, que rejeita qualquer mudança de
  `role` ou `active` por quem não é admin. Verificado vivo (nenhum `DROP TRIGGER`
  posterior).
- **Modo Inspeção:** o bloqueio de escrita é de UI
  (`src/services/portalScope.ts:42-45`, `disabled={scope.mode === 'inspect'}` nos
  componentes), **mas tem lastro no banco** — as RPCs de escrita do Portal
  (`portal_open_demurrage_dispute`, `portal_update_profile`,
  `portal_mark_notification_read`, `portal_create_consolidation`) resolvem o
  cliente por `current_portal_customer_id()`, que é `NULL` na sessão interna, e a
  operação falha. Defesa em profundidade correta.

---

## 3. IDOR — **não confirmado**

- **IDs sequenciais existem** (`invoices.id`, `customers.id` são `BIGSERIAL`), o
  que é aceitável **porque a autorização não depende de o ID ser imprevisível**.
- Toda RPC do Portal casa o recurso com o dono resolvido pelo servidor, nunca com
  um ID vindo do cliente. Exemplo canônico, `portal_invoice_details`
  (`261_freeze_consolidated_invoice_items.sql`):

  ```sql
  v_customer_id bigint := public.current_portal_customer_id();
  ...
  WHERE i.id = p_invoice_id
    AND i.customer_id = v_customer_id;   -- ownership check
  ```

  `current_portal_customer_id()` deriva de `auth.uid()` contra
  `customer_portal_accounts` — o cliente não tem como influenciá-la.
- **A Inspeção do Portal (`292`) é o ponto de maior risco de IDOR e está correta.**
  As RPCs `portal_inspect_*(p_customer_id, ...)` recebem o `customer_id` da URL,
  mas todas passam por `_portal_inspect_guard()`
  (`292_portal_inspection.sql:29-38`), que exige `is_active_read_user()` e levanta
  `42501` caso contrário. Uma conta de Portal chamando
  `portal_inspect_list_invoices(<outro_cliente>)` recebe erro de permissão, não
  dados. Os núcleos `_portal_*_core` estão revogados de `PUBLIC, anon, authenticated`
  (linhas 148, 251-259), então não há atalho por baixo do wrapper.
- Nas rotas internas (`/manifestos/:blId`, `/clientes/:cnpj`, `/viagens/:voyageId`)
  não há IDOR **por decisão de negócio**: `CONTEXT.md` define "visualização global
  interna" — todo perfil interno ativo enxerga todos os registros, e a `291`
  alinhou a RLS a isso. A escrita interna também é global desde a `295` (ver A-01),
com o rastro obrigatório no lugar do bloqueio prévio.

---

## 4. Chaves e segredos expostos — **não confirmado**

- Varredura por chave privada, senha, token de gateway ou API key hardcoded em
  `src/`, `scripts/`, `supabase/`: **nada em código de produção**. Nenhum JWT
  (`eyJ...`) versionado fora de `package-lock.json` (integridade de pacote).
- `.gitignore` cobre `.env` e `.env.*` com exceção de `.env.example`, que só tem
  placeholders. Nenhum `.env` rastreado no git.
- No bundle do front-end só entram: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
  (`src/services/supabase.ts:4-5`) e `VITE_APP_COMMIT_SHA`. Os dois primeiros são
  **públicos por design** — a `anon key` é uma chave de identificação de projeto,
  não de autorização; quem autoriza é a RLS. Não há nenhuma `VITE_*` com segredo.
- `SUPABASE_SERVICE_ROLE_KEY` aparece **apenas** em Edge Functions, sempre via
  `Deno.env.get(...)`, nunca em `src/`. Nenhum caminho leva service role ao browser.
- O DSN do Sentry é hardcoded (`src/lib/telemetry.ts:9`) — correto e documentado
  na própria linha 6: DSN de cliente é público. A configuração é conservadora
  (`sendDefaultPii: false`, `beforeSend` com `scrubPii` sobre exception, message,
  extra, breadcrumbs e query string da URL — `telemetry.ts:103-118`).
- CI usa `${{ secrets.* }}` corretamente para as duas `VITE_*` e para a service
  account do Firebase.

### A-04 — Política de senha do Portal mais fraca que a interna (Baixa)

**Arquivos:** `supabase/functions/portal-invite-activate/index.ts:26`,
`supabase/functions/portal-password-reset/index.ts:8`

```ts
if (body.password.length < 8) return cors(422, { error: 'A senha deve ter pelo menos 8 caracteres.' })
```

O usuário interno precisa de 8 caracteres **com maiúscula, minúscula e dígito**
(`supabase/functions/admin-users/index.ts:5-7`, espelhando
`src/lib/passwordPolicy.ts`). O cliente do Portal precisa só de comprimento 8 —
`"12345678"` é aceito na ativação do convite e na recuperação de senha.

**Por que é perigoso aqui:** a conta do Portal dá acesso a faturas, saldo em
aberto, B/Ls, containers e payload PIX do cliente. O login por CNPJ + senha tem
rate limit no servidor (`portal_login_check_rate_limit`, migration `040`), o que
mitiga bruteforce online, mas não protege contra credential stuffing com senha
óbvia. É uma inconsistência gratuita: a regra mais forte já existe pronta no
repositório.

### A-08 — Segredo de dev hardcoded e secret interpolado no shell do CI (Informativo)

- `scripts/design-audit/sb-shim.cjs:18` — `const JWT_SECRET = 'local-audit-jwt-secret-...'`
  e credenciais `postgres/postgres` como default (linhas 20-26). É um emulador
  local de PostgREST/GoTrue para a skill `design-audit`, marcado "Not for
  production use" na linha 2, não referenciado por nenhum script de
  `package.json` nem importado por `src/`. Sem impacto — vale manter a barreira
  clara para que nunca vire dependência de build.
- `.github/workflows/firebase-deploy.yml:36` —
  `echo '${{ secrets.FIREBASE_SERVICE_ACCOUNT_TRANSHIPPING_DESK }}' > /tmp/firebase-sa.json`
  interpola o secret **na linha de comando do shell**. GitHub substitui antes do
  parsing, então uma aspa simples no conteúdo quebra a citação. Preferir passar
  por `env:` e `printf '%s' "$FIREBASE_SA"`, que não sofre esse problema.

---

## 5. Inputs sem sanitização (XSS / upload) — **não confirmado**

- **Zero ocorrências de `dangerouslySetInnerHTML`, `eval()`, `new Function()` ou
  `element.innerHTML = ...` em todo o `src/`.** Todo texto de usuário (nome de
  cliente, observações, texto de disputa do Portal, campos de planilha importada)
  é renderizado como filho JSX, com escape do React.
- **Único uso de `document.write`:** `src/lib/printDocument.ts:8` e
  `src/pages/Demurrage.tsx:154`, ambos montando a janela de impressão. Analisados
  em detalhe:
  - o corpo é `element.innerHTML`, isto é, a **serialização do DOM que o React já
    escapou** — não é string crua de usuário;
  - o único trecho interpolado como texto é o `title`, vindo de
    `buildInvoiceFileBaseName()` (`src/components/shared/invoiceFormat.ts:101-111`),
    que remove `\ / : * ? " < > |` antes de retornar. Sem `<` e `>` não há como sair
    do elemento `<title>`;
  - ainda que passasse, a CSP de `firebase.json` (`script-src 'self'`, sem
    `unsafe-inline`) bloqueia script inline e handler `on*`, e a janela criada por
    `window.open('')` herda a CSP do documento criador.
  Conclusão: não é vetor explorável. Registrado só para que o filtro de
  `buildInvoiceFileBaseName` seja reconhecido como controle de segurança e não
  removido como "só cosmético de nome de arquivo".
- **Sem `href`/`src` controlado por usuário.** Os únicos dinâmicos são o caminho de
  template estático (`VoyageImportActions.tsx:336`) e o link do MarineTraffic
  (`ShipScheduleWidget.tsx:67`, `ChegadasSaidas.tsx:318`), ambos com o valor
  interpolado no *caminho* de uma URL `https://` fixa — `javascript:` não é
  alcançável.
- **Upload:** o projeto **não usa Supabase Storage** — nenhum arquivo é persistido
  no servidor. Planilhas e EDI são lidos no navegador (`@e965/xlsx`) e o que trafega
  para o banco são **linhas tipadas**, validadas nas RPCs transacionais
  (`import_vehicle_rows_transactional`, `apply_ce_mercante_manifest` etc.), com
  rate limit de importação desde a migration `015`. Isso remove de saída o risco
  clássico de "upload aceita qualquer extensão": não há arquivo salvo, não há
  arquivo servido, não há caminho para web shell.
- 13 dos 14 leitores de arquivo chamam `assertUploadSize` (`src/lib/fileGuard.ts:4`,
  limite de 10 MB) antes do parsing.

### A-07 — Um leitor de planilha sem `assertUploadSize` (Informativo)

**Arquivo:** `src/pages/ChegadasSaidas.tsx:116-125`

```ts
const XLSX = await import('@e965/xlsx')
const buf = await file.arrayBuffer()
const wb = XLSX.read(buf, { cellDates: true })
```

A página lê a planilha direto, sem passar pelo guard que os outros 13 importadores
usam. Impacto é autoinfligido (o usuário interno trava a própria aba com um
arquivo grande), não é vetor de terceiro — mas quebra a convenção do projeto e o
`docs/ARCHITECTURE.md` diz que "arquivos de planilha devem passar pelo limite de
upload antes do parsing".

---

## Superfície das Edge Functions (contexto para os achados acima)

`supabase/config.toml` marca `verify_jwt = false` em 10 das 11 funções. Isso
**não** é um achado por si: cada uma revalida por conta própria, e foi verificado
uma a uma.

| Função | `verify_jwt` | Controle real | Situação |
|---|---|---|---|
| `admin-users` | **true** (default) | `caller.rpc('is_admin')` antes do `service_role` | OK |
| `portal-login` | false | pré-auth por natureza; rate limit + erro genérico + alerta de abuso | OK |
| `portal-invite-send` | false | `caller.rpc('portal_current_role') ∈ {administrativo, documentacao}` | OK |
| `portal-account-suspend` | false | idem | OK |
| `portal-invite-activate` | false | token de 256 bits (`crypto.getRandomValues`), hash SHA-256, consumo idempotente com `WHERE status='pendente'` | OK (ver A-04) |
| `portal-password-recovery` | false | resposta e **tempo** iguais em todo caminho elegível (`EdgeRuntime.waitUntil`) — oráculo de enumeração fechado | OK |
| `portal-password-reset` | false | token de uso único + `revokePortalSessions` | OK (ver A-04) |
| `portal-recovery-email-change` | false | exige JWT do Portal + reconfirmação da senha atual + confirmação por e-mail + revogação de sessões | OK |
| `portal-email-webhook` | false | assinatura svix com `RESEND_WEBHOOK_SECRET`, tolerância 300s, dedup por `provider_event_id` | OK |
| `portal-daily-digest` | false | bearer `PORTAL_DIGEST_SECRET` | OK |
| `notify-invoice-issued` | false | bearer `NOTIFY_WEBHOOK_SECRET` com comparação em tempo constante | OK (inativa) |
| `recalc-demurrage-ptax` | true | JWT | OK |

Nenhuma expõe `service_role` sem gate. Segredos vêm todos de `Deno.env`.

### A-05 — CORS devolve `Access-Control-Allow-Origin: null` (Baixa)

**Arquivo:** `supabase/functions/_shared/cors.ts:15`

```ts
'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.has(origin) ? origin : 'null',
```

Para origem fora da allowlist, o header devolvido é a string literal `null`. Mas
`null` **é uma origem válida** que o navegador apresenta em iframe com `sandbox`,
documento `data:` e alguns redirecionamentos — e o navegador trata
`Access-Control-Allow-Origin: null` como casamento para essas origens. O efeito é
permitir cross-origin exatamente para o contexto mais anônimo possível, em vez de
negar.

**Mitigação existente:** `Access-Control-Allow-Credentials` não é enviado e o
Portal manda o token explicitamente no header `Authorization`, então não há
"cavalgar" a sessão da vítima. O impacto real é baixo.

**Correção sugerida:** **omitir** o header quando a origem não estiver na
allowlist — a ausência do header é a negação correta em CORS.

---

## O que já estava certo (para não regredir)

Estes controles foram verificados vivos e devem ser preservados:

- separação `supabase` / `supabasePortal` por `storageKey`, com o Portal em sessão
  isolada (`src/services/supabase.ts:29-37`);
- trigger `trg_prevent_user_profile_privilege_escalation` (`077`) — sem ele a
  policy de auto-update de `user_profiles` é escalada direta para admin;
- `_portal_inspect_guard()` e o revoke dos `_portal_*_core` (`292`);
- `create_invoice_from_bls_core` revogado de `PUBLIC, anon, authenticated`
  (`141_secure_billing_core_wrappers.sql:15-17`) com os wrappers guardados por
  `is_admin()`/`is_active_user()` elevados a `SECURITY DEFINER` — o ACL sobrevive
  aos `CREATE OR REPLACE` posteriores (`270`);
- `save_granite_bl_review` exigindo `p_changed_by = auth.uid()`
  (`148:15`) — impede forja de autoria na trilha de auditoria;
- CSP restritiva com `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`
  e `base-uri 'self'` (`firebase.json`);
- timeout de sessão interna por inatividade de 8h (`src/hooks/useAuth.tsx:86`);
- `scrubPii` no `beforeSend` do Sentry com redação de query string.

## Fontes relacionadas

- [`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md) — fronteiras de autenticação e contrato do Portal;
- [`docs/archive/audits/security-audit-portal-2026-08-12.md`](./security-audit-portal-2026-08-12.md) — auditoria anterior do Portal;
- [`docs/archive/audits/2026-08-13-rbac-departamentos-visualizacao.md`](./2026-08-13-rbac-departamentos-visualizacao.md) — mapa de RBAC por departamento (origem da migration `291`);
- [`docs/adr/0045-inspecao-do-portal.md`](../../adr/0045-inspecao-do-portal.md) — decisão da Inspeção do Portal.
