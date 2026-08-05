# Security Audit & Penetration Testing — Portal do Cliente

> **Snapshot histórico:** este relatório descreve o repositório na data indicada.
> Achados podem ter sido corrigidos depois. Para o estado atual, consulte
> [`docs/README.md`](../../README.md), o código e as migrations.

**Data:** 2026-08-05 · **Escopo:** Portal do Cliente — fronteira entre a sessão
do cliente e o sistema interno (257 migrations Supabase, RLS/ACL, RPCs, 11 Edge
Functions, rotas e serviços do Portal) · **Método:** inspeção do catálogo real
do Postgres em produção, análise estática do repositório e testes de penetração
executados contra banco descartável local (`scripts/setup-local-pg.sh`) com
replay completo das migrations. Padrões referenciados: OWASP Top 10 2023
(A01 Broken Access Control), CWE-639, CWE-732, CWE-284.

Rótulos de evidência conforme [`docs/CONVENCOES.md`](../../CONVENCOES.md):
**Código**, **Teste**, **Teste de contrato SQL**, **Runtime**, **Suspeita**.

**Premissas auditadas:**

1. Nenhum cliente pode visualizar dados do sistema interno que não foram
   desenhados para ele.
2. Nenhum cliente pode visualizar dados de outro cliente.

---

## 1. Sumário executivo

**Postura geral: forte, com um contorno sistêmico.** O núcleo do isolamento está
correto e foi confirmado em runtime: as 16 RPCs de dados do Portal resolvem o
cliente por `current_portal_customer_id()`, as RPCs internas de provisionamento
exigem `_portal_actor_role()`, e as tabelas de negócio exigem
`is_active_read_user()` ou `is_admin()`. Uma sessão de cliente leu **0 de 129**
B/Ls em produção. **Runtime**

O problema não está no núcleo, está na borda. **O cliente do Portal autentica no
mesmo role `authenticated` do usuário interno.** O role não separa os dois; quem
separa é o perfil (`user_profiles` para interno, `customer_portal_accounts` para
cliente). Logo, todo objeto que autoriza por "estar autenticado" — policy
`USING (true)` ou função `SECURITY DEFINER` sem guarda — é um vazamento direto
para o cliente.

Agravante sistêmico: o projeto tem `ALTER DEFAULT PRIVILEGES` concedendo
`EXECUTE` a `anon` **e** `authenticated` em toda função nova de `public`. Toda
função nasce alcançável pelo cliente do Portal; só um `REVOKE` explícito fecha.
E `REVOKE ... FROM PUBLIC` **não** remove esses grants, porque eles são
explícitos por role — foi o que deixou `mark_overdue_invoices` aberta mesmo com
a migration `031` concedendo apenas a `service_role`. **Runtime**

**Resultado:** 6 achados — 2 ALTO, 4 MÉDIO. Todos corrigidos na migration `257`
e validados por teste de penetração antes/depois.

| # | Achado | Severidade | Premissa ferida | Status |
|---|---|---|---|---|
| 1 | `list_billing_runs` sem guarda | 🔴 Alto | 1 e 2 | Corrigido |
| 2 | `mark_overdue_invoices` sem guarda (escrita global) | 🔴 Alto | 1 | Corrigido |
| 3 | `check_provision_rate_limit` sem guarda (escrita) | 🟠 Médio | 1 | Corrigido |
| 4 | `bl_has_portal_release` como oráculo entre clientes | 🟠 Médio | 2 | Corrigido |
| 5 | `vessel_schedules` com policy `USING (true)` | 🟠 Médio | 1 | Corrigido |
| 6 | `ended_vessels` com policy `USING (true)` | 🟠 Médio | 1 | Corrigido |

---

## 2. Modelo de ameaça

O atacante é um **cliente legítimo do Portal**: possui CNPJ e senha válidos e,
após o login, um JWT com `role = authenticated` e um `auth.uid()` que existe em
`customer_portal_accounts` mas **não** em `user_profiles`.

Esse ator alcança, pela API REST do Supabase, qualquer tabela com policy
permissiva para `authenticated` e qualquer função com `EXECUTE` para
`authenticated` — sem passar pelo frontend. O roteador React é irrelevante para
a fronteira; a segurança real está em RLS, grants e guardas nas RPCs
(`docs/ARCHITECTURE.md`). **Código**

Nos testes, essa identidade foi reproduzida fielmente: role `authenticated` +
`auth.uid()` sem perfil interno, confirmada por
`is_active_read_user() = false`. **Runtime**

---

## 3. Achados

### 3.1 🔴 ALTO — `list_billing_runs` expõe o faturamento da operação inteira

**Onde:** `public.list_billing_runs(integer)` — `SECURITY DEFINER`, `EXECUTE`
para `authenticated`, **sem nenhuma verificação de identidade**. **Código**

**Impacto:** qualquer cliente logado lê o histórico completo de execuções de
faturamento de toda a operação: nome do arquivo de manifesto, origem do
disparo, contagens de B/L (total, elegíveis, bloqueados, calculados) e totais em
BRL e USD. São dados internos de todos os clientes num único retorno — fere as
duas premissas. CWE-732, OWASP A01.

**PoC (produção, leitura):** com JWT de sessão não-interna, a chamada executou
sem qualquer bloqueio. **Runtime**

**PoC (banco descartável, com dados):** cliente do Portal recebeu **1 linha**
correspondente ao `billing_run` semeado. **Runtime**

**Correção:** guarda `WHERE public.is_active_read_user()` no corpo (mesmo padrão
já usado por `bl_timeline`), preservando o uso interno, mais `REVOKE` de
`PUBLIC` e `anon`.

### 3.2 🔴 ALTO — `mark_overdue_invoices` permite escrita global não autorizada

**Onde:** `public.mark_overdue_invoices()` — `SECURITY DEFINER` sem guarda.
A migration `031` concedeu `EXECUTE` apenas a `service_role`, mas o
`ALTER DEFAULT PRIVILEGES` do projeto já havia concedido `authenticated` na
criação, e `REVOKE ... FROM PUBLIC` não remove grant explícito de role. ACL
observada em produção: `postgres=X | authenticated=X | service_role=X`.
**Runtime**

**Impacto:** qualquer cliente logado dispara `UPDATE public.invoices SET status
= 'overdue'` sobre **todas** as faturas `issued` vencidas, de **todos** os
clientes. Não é vazamento, é corrupção de estado financeiro — e um cliente pode
usá-la para marcar as próprias faturas como vencidas ou poluir o painel
interno.

**PoC:** cliente do Portal executou a escrita global com sucesso. **Runtime**

**Correção:** a fronteira aqui **tem de ser o grant, não uma guarda no corpo**.
A função roda no job `mark-overdue-invoices` do `pg_cron`, que executa sem JWT
(`auth.role()` e `auth.uid()` nulos); uma guarda por identidade quebraria o job
diário. O corpo permanece como a migration `157` o deixou, e o `EXECUTE` volta a
ser exclusivo de `service_role`. A preservação do job foi verificada. **Runtime**

### 3.3 🟠 MÉDIO — `check_provision_rate_limit` grava sem guarda, com alvo arbitrário

**Onde:** `public.check_provision_rate_limit(uuid)` — `SECURITY DEFINER`, sem
guarda, aceitando `p_user_id` arbitrário e **inserindo** em
`provision_rate_limit_log`. **Código**

**Impacto:** um cliente chama a função 20 vezes com o UUID de um usuário interno
e esgota a janela de rate limit desse usuário — negação de serviço sobre o
provisionamento do Portal. Também permite crescimento ilimitado da tabela de
log. CWE-639 (referência direta a objeto), OWASP A01.

**PoC:** cliente do Portal executou a função contra o UUID do usuário interno,
retornando `true` e gravando a linha. **Runtime**

**Correção:** `EXECUTE` exclusivo de `service_role`, que é o consumo previsto
(Edge Function). Não há chamador no app. **Código**

### 3.4 🟠 MÉDIO — `bl_has_portal_release` é um oráculo sobre B/L de outros clientes

**Onde:** `public.bl_has_portal_release(text)` — `SECURITY DEFINER`, sem guarda
e **sem escopo de cliente**; recebe um `bl_id` arbitrário. **Código**

**Impacto:** fere a premissa 2. O cliente informa o identificador de um B/L de
**outro** cliente e descobre se ele já tem CE Mercante — isto é, se foi liberado
para o Portal. Combinado com enumeração de `bl_id`, revela ritmo operacional e
situação documental da carteira alheia. É vazamento por inferência, não por
leitura direta, e por isso não aparece em revisão de RLS.

**PoC:** sessão do Cliente A consultou `BL-DO-CLIENTE-B` e recebeu `true`.
**Runtime**

**Correção:** a função é helper interno do portão de CE Mercante, não API. Os
**sete** chamadores são todos `SECURITY DEFINER` e executam como owner, então o
`REVOKE` de `authenticated` não altera o comportamento do Portal — verificado
por regressão nas cinco RPCs de dados. **Runtime**

### 3.5 / 3.6 🟠 MÉDIO — `vessel_schedules` e `ended_vessels` com `USING (true)`

**Onde:** eram as **únicas** policies de `SELECT` com `USING (true)` do schema,
ambas `TO authenticated`. **Runtime**

**Impacto:** leitura integral das duas tabelas por qualquer cliente do Portal,
contornando o portão `voyages.show_on_portal` — justamente o mecanismo que
decide o que o cliente pode ver da programação de navios. A
`docs/RASTREABILIDADE.md` já registrava a permissividade como **Suspeita**
("leitura não exige perfil interno ativo, intencionalmente compatível com
Portal"); esta auditoria encerra a suspeita como defeito.

**Exposição atual:** latente. As duas tabelas estão vazias em produção e o
caminho de leitura (`services/vesselSchedules.ts` + `hooks/useVesselSchedules.ts`,
que liam pela sessão do Portal) não tinha **nenhum** consumidor — o widget real
usa a RPC `portal_ship_schedule`, essa sim com o portão. Vira vazamento efetivo
no instante em que a tabela for repovoada. **Código**

**PoC:** em produção, linha-canário inserida em transação revertida foi lida
pela sessão não-interna (1 linha), enquanto `bls` retornou 0 de 129 na mesma
sessão — o controle que prova que a RLS funciona onde está bem escrita.
**Runtime**

**Correção:** `USING (public.is_active_read_user())` nas duas policies de
`SELECT`; as policies de escrita já exigiam usuário interno e permaneceram
intactas. O serviço e o hook mortos foram removidos, eliminando o caminho.

---

## 4. Teste de penetração — antes e depois

Executado contra banco descartável com replay das 257 migrations
(`scripts/setup-local-pg.sh --reset`), com duas identidades reais e dados
semeados. O estado "antes" foi reproduzido restaurando as definições
vulneráveis dentro de uma transação revertida. **Runtime**

| # | Objeto | Cliente do Portal — ANTES | Cliente do Portal — DEPOIS |
|---|---|---|---|
| 1 | `list_billing_runs` | 1 linha vazada | 0 linhas |
| 2 | `mark_overdue_invoices` | executou escrita global | negado `42501` |
| 3 | `check_provision_rate_limit` | executou escrita | negado `42501` |
| 4 | `bl_has_portal_release` | oráculo: `true` para B/L alheio | negado `42501` |
| 5 | `vessel_schedules` | 1 linha vazada | 0 linhas |
| 6 | `ended_vessels` | 1 linha vazada | 0 linhas |
| — | `bls` (controle) | 0 linhas | 0 linhas |

**Não regressão do usuário interno (depois):** `list_billing_runs` 1 linha,
`vessel_schedules` 1, `ended_vessels` 1, `bls` 2. **Runtime**

**Não regressão do Portal (depois):** `portal_list_operation_bls`,
`portal_list_invoices`, `portal_list_demurrage_invoices`,
`portal_list_consolidatable_receivables` e `portal_get_session_overview_v2` — as
cinco OK. **Runtime**

**Isolamento entre clientes (premissa 2):** com dois B/Ls na base, um de cada
cliente, `portal_list_operation_bls` na sessão do Cliente A retornou
exatamente `BL-DO-CLIENTE-A`. **Runtime**

**Job `pg_cron` preservado:** `mark_overdue_invoices` executou sem JWT. **Runtime**

---

## 5. Verificado e considerado correto

- **16 RPCs de dados do Portal** resolvem o cliente por
  `current_portal_customer_id()`, que lança `28000` quando `auth.uid()` é nulo
  ou a conta está inativa. **Código**
- **RPCs internas de provisionamento** (`portal_admin_change_cnpj`,
  `portal_assisted_email_change`, `portal_cancel_invite`, `portal_set_exception`,
  `portal_return_to_analysis`, `portal_list_provisioning_console`,
  `portal_list_provisioning_events`) exigem `_portal_actor_role()`. Chamada com
  sessão de cliente retornou `42501 permission denied`. **Runtime**
- **Tabelas de negócio** (`bls`, `customers`, `invoices`, `demurrage_invoices`,
  …) exigem `is_active_read_user()` ou `is_admin()`; ambas dependem de linha
  ativa em `user_profiles`, que conta de Portal nunca tem. **Runtime**
- **`bl_timeline` e `get_consolidated_invoice_item_breakdown`** guardam no
  `WHERE` (`is_active_read_user()`, `is_admin()`) — retornam vazio ao cliente.
  Falsos positivos de varredura por `RAISE`. **Código**
- **Sem views em `public`** — não há bypass de RLS por view sem
  `security_invoker`. **Runtime**
- **Edge Functions** validam o papel do chamador via `portal_current_role()`
  antes de usar `service_role`; `portal-recovery-email-change` resolve a conta
  por `auth_user_id` do JWT, sem aceitar identificador do corpo. **Código**
- **`portal_ship_schedule` concedida a `anon`** é allowlist deliberada e testada
  (`portalShipScheduleMigration.test.ts`), com filtro `show_on_portal` e
  `status = 'active'`. Mantida. **Teste**

---

## 6. Recomendações permanentes

1. **Trate `authenticated` como papel de cliente, não de usuário interno.**
   Toda policy e toda função nova precisa de guarda por perfil. Policy de
   leitura com `USING (true)` é, por definição, exposição ao Portal.
2. **Revogue `anon` e `authenticated` explicitamente em toda função nova.** O
   `ALTER DEFAULT PRIVILEGES` do projeto concede EXECUTE aos dois na criação, e
   `REVOKE ... FROM PUBLIC` não desfaz isso. O playbook
   `skills/supabase-migration` já exige revogar `PUBLIC` e `anon`; o achado 3.2
   mostra que `authenticated` precisa entrar na mesma regra quando a função é
   interna.
3. **Escolha entre guarda e grant conforme o chamador.** Função chamada por
   `pg_cron` executa sem JWT: guarda por identidade a quebra, e a fronteira
   precisa ser o grant.
4. **Funções que recebem identificador de domínio** (`bl_id`, `invoice_id`,
   `customer_id`) precisam de escopo por `current_portal_customer_id()` ou de
   guarda interna — mesmo quando retornam só um booleano. O achado 3.4 vazava
   por inferência.
5. **Rode a varredura de contorno a cada frente**: policies `USING (true)`,
   funções `SECURITY DEFINER` sem guarda e ACLs com `authenticated` em objetos
   internos. O teste
   `src/services/__tests__/portalAuthenticatedBoundaryMigration.test.ts` cobre
   a regressão dos seis achados. **Teste de contrato SQL**

---

## 7. Correções aplicadas

Migration `257_portal_authenticated_boundary_hardening.sql`:

| Objeto | Antes | Depois |
|---|---|---|
| `list_billing_runs(integer)` | sem guarda | `WHERE is_active_read_user()`; revoga `PUBLIC`, `anon` |
| `mark_overdue_invoices()` | `authenticated` com EXECUTE | EXECUTE exclusivo de `service_role`; corpo intacto (pg_cron) |
| `check_provision_rate_limit(uuid)` | sem guarda | EXECUTE exclusivo de `service_role` |
| `bl_has_portal_release(text)` | `authenticated` com EXECUTE | EXECUTE exclusivo de `service_role` |
| `vessel_schedules` SELECT | `USING (true)` | `USING (is_active_read_user())` |
| `ended_vessels` SELECT | `USING (true)` | `USING (is_active_read_user())` |

Código morto removido: `src/services/vesselSchedules.ts`,
`src/hooks/useVesselSchedules.ts` e o teste correspondente — o caminho de
leitura de `vessel_schedules` pela sessão do Portal.

Documentação viva atualizada: `docs/ARCHITECTURE.md` (fronteira do role
`authenticated` e programação de navios), `docs/RASTREABILIDADE.md` (Suspeita
encerrada nas duas tabelas), `docs/modules/chegadas-saidas.md` e
`docs/modules/portal-cliente.md`.

---

**Auditoria concluída em 2026-08-05.** 6 achados, 6 corrigidos, 6 validados por
teste de penetração antes/depois em banco descartável, sem regressão no Portal,
no usuário interno ou no job diário.
