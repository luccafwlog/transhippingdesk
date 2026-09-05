# Auditoria de Banco de Dados, Ciclo CRUD e Requisições

> **Snapshot histórico:** este relatório descreve o repositório na data indicada.
> Achados podem ter sido corrigidos depois. Para o estado atual, consulte
> [`docs/README.md`](../../README.md), o código e as migrations.

**Data:** 2026-09-05 · **Escopo:** os seis módulos do Transhipping Desk
(Operação Marítima, Cargas/B-Ls/CE Mercante, Financeiro/Demurrage,
Clientes/Caixas de Comunicação, Segurança/RLS/Portal, Alertas/`app_settings`) ·
**Método:** varredura estática das 8 migrations (43.297 linhas, 110 tabelas,
280 policies), extração com parser de parênteses balanceados das assinaturas de
funções e grants, resolução **transitiva** de guards de autorização através das
cadeias de wrappers, e varredura dos 945 arquivos TypeScript (133.198 linhas)
para chamadas `supabase.from/rpc`, `useMutation` e blocos `catch`.

Rótulos de evidência conforme [`docs/CONVENCOES.md`](../../CONVENCOES.md):
**Código**, **Teste**, **Suspeita**.

---

## 1. Veredito

A fronteira de segurança e a disciplina de cache **não têm lacunas**. Os achados
reais estão todos numa faixa estreita: **falhas parciais em importações que
gravam fora de uma RPC transacional**, e **erros engolidos com `catch` vazio**
contornando o repórter que o próprio projeto já mantém.

| Vetor auditado | Resultado |
|---|---|
| RLS habilitada em todas as tabelas | 110/110 — sem exceção |
| Tabelas alcançáveis pelo cliente sem policy | 0 (8 são deny-all e só têm acesso via `SECURITY DEFINER`) |
| Policies permissivas (`USING (true)`) para `authenticated` | 0 |
| Policies concedidas a `anon` | 0 |
| Vazamento multi-tenant no Portal | **Nenhum encontrado** (ver §2) |
| RPCs `SECURITY DEFINER` alcançáveis pelo cliente sem guard | 0 (ver §2.2) |
| Drift de nome/argumento entre `rpc()` no cliente e migrations | 0 |
| `useMutation` sem invalidação ou `onSuccess` | 0 de 79 |
| Updates otimistas sem rollback | N/A — não existe `onMutate` no repositório |
| String vazia gravada em coluna `uuid`/`date`/`numeric` | 0 |
| Botões de ação financeira sem trava de duplo clique | 0 (ver §4.3) |
| Importações não atômicas | **2** (P1-01, P2-01) |
| `catch` vazio engolindo falha de negócio | **5 sítios** (P1-02, P2-02, P3-02) |

---

## 2. Fase 1 — Schema, RLS e isolamento do Portal

### 2.1 Isolamento multi-tenant (P0 — sem achado)

O Portal e o app interno compartilham o mesmo projeto Supabase, portanto **uma
sessão do Portal também é `authenticated`**. Qualquer RPC ou policy concedida a
`authenticated` está ao alcance de um cliente externo. Essa foi a hipótese de
ataque central da auditoria.

O isolamento se apoia em duas populações disjuntas:

- interno → linha em `user_profiles` (`is_active_read_user()`, `is_admin()`);
- Portal → linha em `customer_portal_accounts` (`current_portal_customer_id()`).

O Portal não faz `supabase.from(...)` em tabela alguma: todo acesso passa por
`callPortalRpc` (`src/services/portalScope.ts`), e cada RPC deriva o
`customer_id` de `auth.uid()` — nunca de argumento do cliente.

As 14 RPCs `portal_inspect_*` **aceitam** `p_customer_id` e são concedidas a
`authenticated`, o que à primeira vista parece um vetor de troca de id. Elas são
seguras porque todas passam o argumento por `_portal_inspect_guard()`, que exige
`is_active_read_user()` — condição que uma sessão do Portal nunca satisfaz.
**Evidência: Código** (`supabase/migrations/002_business_logic_and_security.sql`,
`_portal_inspect_guard`).

### 2.2 Guards em `SECURITY DEFINER` (sem achado)

A varredura ingênua acusou 6 RPCs `SECURITY DEFINER` concedidas a `authenticated`
sem guard aparente. **Todas as 6 são falsos positivos**, por dois motivos
legítimos que qualquer auditoria futura deve considerar antes de abrir um P0:

1. **Guard na base da cadeia de wrappers.** `import_bl_freight_transactional`
   delega para `_legacy_357` → `_legacy_322` → `_legacy_284` → `_legacy_205`, e é
   o `_legacy_205` que valida `is_active_user()` e
   `p_changed_by IS DISTINCT FROM auth.uid()`. O mesmo padrão vale para
   `save_granite_bl_review` (guard em `_legacy_148`) e
   `save_voyage_escala_terminal_state_v2` (guard em
   `save_voyage_escala_terminal_state`).
2. **Guard inline em vez de helper.** As três RPCs de ADR por `report_id`
   (`set_agency_report_signoff_by_report_id` e irmãs) consultam `user_profiles`
   diretamente, sem chamar `is_active_read_user()`.

`portal_ship_schedule()` é concedida a `anon` **por desenho**: expõe apenas
viagens com `show_on_portal AND status = 'active'`, conforme
[`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md).

Observação de ordem, sem exploração conhecida:
`save_voyage_escala_terminal_state_v2` insere em `public.ports` **antes** de
delegar para a função guardada. Um chamador não autorizado não persiste nada
(a exceção aborta a transação), mas a ordem inverte a regra de "autorizar antes
de escrever". **Evidência: Código.**

### 2.3 Drift de tipos (sem achado)

14 tabelas existem nas migrations e não em `src/types/database.ts`
(`alert_items`, `internal_notifications`, `demurrage_disputes`, …). **Não é
drift**: nenhuma delas é acessada por `supabase.from(...)` no cliente — todas são
mediadas por RPC. Os tipos gerados cobrem exatamente a superfície de tabela
alcançável diretamente.

### 2.4 Invariantes de domínio conferidas

| Invariante | Estado |
|---|---|
| Omissão dupla do mesmo POD bloqueada | **Sim** — `UNIQUE (voyage_id, omitted_pod)` em `voyage_omissions`, mais checagem explícita em `omit_voyage_escala` que levanta `23505` com mensagem de negócio |
| Omissão preserva histórico | **Sim** — insere em `bl_transshipments`, dois registros em `audit_logs`, não toca `bls.pod` |
| Contatos: `FOR UPDATE` pessimista | **Sim** — `_apply_customer_contact_configuration` |
| Contatos: auditoria append-only | **Sim** — `customer_contact_change_events` |
| `app_settings` restrito a Administrativo + log | **Sim** — `set_communications_enabled` exige `_portal_actor_role() = 'administrativo'`, faz `FOR UPDATE` e grava em `audit_logs` |

**Correção à premissa do escopo:** a tabela `scale_omissions` **não existe**. O
nome real é `voyage_omissions`. `depots` também não tem
`preflight_depots_terminal_port_mapping` como constraint — é procedimento de
migração.

---

## 3. Fase 2 — Serviços e hooks

### 3.1 Cache React Query (sem achado)

79 blocos `useMutation`; **todos** têm `onSuccess`/`onSettled` com invalidação.
O padrão dominante extrai a invalidação para helper nomeado
(`useInvalidateRates()`) ou para os eventos de domínio de
`src/services/cacheEffects.ts` (`afterEscalaAlterada`, `afterViagemAlterada`),
conforme a skill `react-query-pattern`. Não há `onMutate` no repositório,
portanto o critério de rollback otimista não se aplica.

### 3.2 Tradução de erro do Postgres (sem achado de vazamento)

`src/lib/errors.ts` mapeia os códigos relevantes e — o detalhe que costuma
faltar — tem um guard `raw` que detecta `violates ... constraint` /
`permission denied for table` e **descarta** a mensagem crua mesmo quando a
entrada está marcada `preserveMessage`. Nenhum `23505` cru chega à tela.

Ponto de atenção, não achado: 27 sítios usam `classifyDbError` contra ~77 que
exibem `error.message` direto. A maioria destes últimos trata erros de aplicação
(`new Error('Falha ao ...')`), não erros do Postgres, mas a fronteira não é
explícita e tende a erodir. **Evidência: Suspeita.**

---

## 4. Fase 3 — Matriz de risco CRUD

`OK` = verificado sem achado. `P1`/`P2`/`P3` remetem à Fase 4.

| Entidade / Módulo | Create | Read | Update | Delete/Cancel | RLS | Status |
|---|---|---|---|---|---|---|
| Viagens / Escalas / Atracações | OK | OK | OK | OK (preserva vínculo) | OK | **OK** |
| Omissão de escala (`voyage_omissions`) | OK | OK | OK | OK (append-only) | OK | **OK** |
| ADR (`agency_departure_reports`) | OK | OK | OK | OK | OK | **OK** |
| Terminais / `depots` | OK | OK | OK | OK | OK | **OK** |
| B/Ls e frete (import) | P2-01 | OK | OK | OK | OK | **P2** |
| CE Mercante (planilha e EDI) | P1-02 | OK | OK | OK | OK | **P1** |
| Containers — datas/devolução (import) | P1-01 | OK | P1-01 | OK | OK | **P1** |
| Manifestos (Breakbulk/Granito/Vazios/Baplie) | OK (RPC transacional) | OK | OK | OK | OK | **OK** |
| Invoices / Taxas Locais | OK | OK | OK | OK | OK | **OK** |
| Demurrage / Disputas | OK | OK | OK | OK | OK | **OK** |
| Clientes / Contatos / Caixas | OK | OK | OK | OK (lógico) | OK | **OK** |
| Portal do Cliente | OK | OK | OK | OK | OK | **OK** |
| Alertas / Notificações | OK | OK | OK | OK | OK | **OK** |
| `app_settings` (singleton) | — | OK | OK | — | OK | **OK** |

### 4.3 Duplo clique (sem achado)

16 botões de ação aparecem sem prop `disabled`, mas o componente compartilhado
resolve isso na origem: `src/components/ui/Button.tsx` faz
`disabled={disabled || loading}`. Todos os botões de emissão, aprovação e
faturamento passam `loading={mutation.isPending}`. As exceções restantes são
seleção, impressão e abas — sem mutação.

---

## 5. Fase 4 — Inventário de lacunas

### P1-01 — Import de datas de container é não atômico e perde faturamento de Demurrage em definitivo

**Arquivo:** `src/services/containerDatesImport.ts#L133` (antes da correção)
**Evidência: Código + Teste**

`importContainerDates` percorre as linhas gravando **uma requisição PostgREST por
linha** — cada uma sua própria transação — e fazia `throw updateError` na
primeira falha.

Cenário de reprodução:

1. Planilha com 200 containers; a linha 120 falha (conflito, RLS, timeout).
2. As 119 primeiras **já estão gravadas**; o operador vê apenas
   `Falha ao importar datas.` sem contagem — a "meia carga" da premissa.
3. O laço de faturamento (`blsToCheckForInvoice`) **nunca roda**.
4. O operador reimporta o mesmo arquivo. As 119 linhas caem em
   `if (sameDischarge && sameReturn) { unchanged += 1; continue }` — e portanto
   **não** entram em `blsToCheckForInvoice`.

O passo 4 é o dano real: os containers ficam `returned` e a fatura de Demurrage
correspondente **nunca nasce**, e reimportar não cura. É perda de receita
silenciosa.

**Correção aplicada:** o laço acumula erro por linha em vez de abortar; a linha
inalterada cujo container já está `returned` é reenfileirada para faturamento
(`createInvoiceForReturnedBL` é idempotente); o laço de faturamento isola falha
por B/L; o resultado ganha `errors[]`, exibido no modal.

### P1-02 — Falha do faturamento automático pós-CE Mercante é engolida por `catch` vazio

**Arquivos:** `src/services/ceMercanteImport.ts#L208`, `#L264`
**Evidência: Código**

```ts
await maybeAutoBillAfterCeMercante(row.bl_id, options.changedBy).catch(() => {})
```

`maybeAutoBillAfterCeMercante` gera invoice. Sua falha não produzia toast, log,
nem evento Sentry — e o import ainda reportava sucesso. O projeto já mantém
`reportBestEffortFailure` (`src/lib/telemetry.ts`, `console.warn` + Sentry) usado
em 12 sítios exatamente para isto; estes dois o contornavam. Também não carregam
comentário `ponytail:`, ou seja, não são atalho sancionado pela convenção.

**Correção aplicada:** ambos os sítios passam a chamar
`reportBestEffortFailure` com contexto e `blId`.

### P2-01 — Gravações fora da RPC transacional no import de B/L

**Arquivo:** `src/services/blFreightImport.ts#L517-L537`
**Evidência: Código**

Depois de `import_bl_freight_transactional` (atômica), o serviço insere em
`import_batches` e faz `update` em `bls.batch_id` — duas transações separadas. Se
o `update` falhar, sobra uma linha de lote com `status: 'completed'` e
`total_bls: N` sem nenhum B/L apontando para ela.

**Correção sugerida (não aplicada):** mover ambas as gravações para dentro da RPC
transacional, ou criar `link_bl_import_batch(p_voyage_id, p_bl_ids, ...)` que faça
insert e vínculo numa transação. Fora do escopo desta correção por exigir
migration.

### P2-02 — Flags físicas do Baplie e taxas provisórias engolidas por `catch` vazio

**Arquivo:** `src/services/blFreightImport.ts#L503`, `#L509`
**Evidência: Código**

Mesmo padrão do P1-02. Agrava porque `applyBapliePhysicalFlags` aplica flags
IMO/OOG — carga perigosa. Sem sinal algum, ninguém descobre que não foram
aplicadas.

**Correção aplicada:** ambos passam por `reportBestEffortFailure`.

### P3-01 — `omit_voyage_escala` degrada a mensagem sob concorrência

**Arquivo:** `supabase/migrations/002_business_logic_and_security.sql`
**Evidência: Código**

O `IF EXISTS` seguido de `INSERT` não é atômico entre chamadas simultâneas. A
`UNIQUE` garante a correção, mas o segundo chamador recebe o `23505` cru — que
`classifyDbError` reduz a "Este registro ja existe." em vez da mensagem de
negócio. Impacto apenas de texto.

### P3-02 — `catch` vazio no sino de notificações

**Arquivo:** `src/components/layout/InternalNotificationBell.tsx#L85`, `#L123`
**Evidência: Código**

`markRead`/`markAllRead` engolem a falha. Consequência cosmética (o badge não
zera). Não corrigido para manter o diff estreito.

### P3-03 — Falha transitória ao carregar perfil derruba o perfil sem aviso

**Arquivo:** `src/hooks/useAuth.tsx#L136`, `#L153`
**Evidência: Suspeita**

`catch { setProfile(null) }` não distingue "sem perfil" de "rede caiu". Uma falha
transitória degrada o usuário a sem-perfil sem mensagem. Precisa de teste de
runtime para confirmar o efeito em `ProtectedRoute`.

---

## 6. Correções aplicadas nesta mudança

| Achado | Arquivo | Natureza |
|---|---|---|
| P1-01 | `src/services/containerDatesImport.ts` | Lote resiliente + cura do faturamento perdido + `errors[]` |
| P1-01 | `src/components/shared/ContainerDatesImportModal.tsx` | Exibe erros de gravação; usa `classifyDbError` |
| P1-02 | `src/services/ceMercanteImport.ts` | `reportBestEffortFailure` nos 2 sítios |
| P2-02 | `src/services/blFreightImport.ts` | `reportBestEffortFailure` nos 2 sítios |
| P1-01 | `src/services/__tests__/containerDatesImport.test.ts` | 2 testes de regressão (vermelho confirmado antes da correção) |

Pendentes por exigirem migration ou investigação de runtime: **P2-01**, **P3-01**,
**P3-03**.

## 7. Verificação

`npm run lint` limpo · `npm test` 2.833 testes passando, 43 skipped ·
`npm run build` sem erro · os 2 testes novos verificados **falhando** contra o
código anterior e passando após a correção.
