# Auditoria de conformidade arquitetural, código morto e dívida técnica

Data: 2026-09-06. Commit base: `bdf2241` (merge da PR 653).
Escopo: confronto entre o código executável e `docs/ARCHITECTURE.md`,
`docs/RASTREABILIDADE.md`, `docs/adr/` e `CONTEXT.md`.

Método: inventário estático do repositório (chamadas `.rpc`, corpos de função
das migrations 001–008, grafo de chamadas SQL, triggers, jobs `pg_cron`,
`.from()` do frontend) cruzado com verificação **Runtime** no projeto Supabase
de produção `fgmkhbzhaeebrsizwccx` (catálogo `pg_proc`, `proacl`, `cron.job`,
contagens de linhas). Nenhuma escrita foi feita no banco.

> **Contexto de volumetria que atravessa todo o relatório:** a base de produção
> está praticamente vazia — 0 B/Ls, 0 containers, 0 invoices, 0 faturas de
> Demurrage, 0 clientes, 0 contatos; 36 viagens, 121 `alert_items` e 269
> `audit_logs`. O sistema ainda não entrou em operação real (coerente com a
> ADR 0062, escrita "antes de sua entrada formal em produção"). Isso muda a
> leitura do vetor 3: **nenhum teto declarado em comentário `ponytail:` foi
> atingido**, porque não há volume. O valor do inventário aqui é priorizar o
> que quebra primeiro quando o volume chegar, não apagar incêndio. **Runtime.**

## Sumário executivo

| # | Achado | Severidade | Vetor | Evidência |
|---|---|---|---|---|
| 1 | `recalc-demurrage-ptax` não tem agendamento algum: o recálculo diário da ADR 0014 não roda | **P0** | 2, 4 | Runtime |
| 2 | `upsert_portal_invoice_exception` é executável por `anon` (grant a `PUBLIC` sobrevivente) | **P0** | 4 | Runtime |
| 3 | Modo Inspeção quebra na aba de faturamento: `portal_inspect_list_disputes` não existe | **P1** | 4 | Runtime |
| 4 | `src/types/database.ts` divergiu do schema: 55 RPCs expostas ausentes, 6 declaradas inexistentes | **P1** | 1, 2 | Código + Runtime |
| 5 | `portal_list_operation_bls_legacy` chama função inexistente — erro em tempo de execução | **P2** | 2 | Runtime |
| 6 | 14 funções mortas no schema (13 `*_legacy` + `reconcile_bl_review_alerts_item`) | **P2** | 2 | Runtime |
| 7 | `RASTREABILIDADE.md` desatualizada: contagens erradas, 2 caminhos inexistentes, 83 RPCs fora do índice | **P2** | 1 | Código |
| 8 | Trilha de auditoria escrita pelo cliente e não atômica em `applyBapliePhysicalFlags` (ADR 0046) | **P2** | 4 | Código |
| 9 | 4 colunas mortas e 2 write-only no schema | **P3** | 2 | Código |
| 10 | `ponytail:` obsoletos (1) e com gatilho de upgrade já disparado (2) | **P3** | 3 | Código |

---

## Vetor 1 — Drift de rastreabilidade

### 1.1 Cabeçalho de `RASTREABILIDADE.md` está numericamente errado

O documento declara (linhas 10–12):

> "Nesta etapa foram inventariados 61 nomes literais de RPC, 41 tabelas
> acessadas diretamente e os diretórios de `supabase/functions` (hoje 13 Edge
> Functions além de `_shared`)."

Contagem real no repositório:

| Métrica | Documento | Real | Método |
|---|---|---|---|
| Nomes literais de RPC chamados | 61 | **130** | `.rpc('…')` em `src/`, `supabase/functions/`, `scripts/` |
| RPCs expostas a `authenticated`/`anon` | — | **198** (repo) / **216** (produção) | grants das migrations; `has_function_privilege` |
| Tabelas acessadas diretamente pelo frontend | 41 | **62** | `.from('…')` em `src/` |
| Edge Functions | 13 | **15** | diretórios em `supabase/functions/` além de `_shared` |

As duas Edge Functions que entraram depois da última verificação do documento
são `customer-communication-auto-runner` e `send-customer-communication`
(ambas citadas no corpo do documento, mas não contabilizadas no cabeçalho).
**Código.**

### 1.2 Itens do índice que nunca existiram no código

Dois caminhos citados em backticks não existem (150 caminhos verificados, 2
falham). O ponto importante: **nenhum dos dois é resíduo de refatoração** —
`git log --all` sobre os dois caminhos não retorna commit algum. São
referências a artefatos que nunca foram escritos.

| Linha | Documento diz | Realidade |
|---|---|---|
| 195 | Rota `/line-up-tv` → `src/pages/LineUpTV.tsx`, com `Navigate` dedicado e `replace` | O arquivo nunca existiu e `/line-up-tv` nunca foi uma `<Route>` em `src/App.tsx`. O **comportamento** documentado até acontece — o catch-all `<Route path="*" element={<Navigate to="/painel" replace />} />` (`src/App.tsx:211`) leva qualquer caminho interno desconhecido a `/painel`. O que não existe é a implementação descrita. |
| 406 | `src/services/codAdjustments.ts` | Nunca existiu. O serviço real é `src/services/billingLedger.ts` (+ `src/hooks/useBillingLedger.ts`); `CodAdjustmentsPanel.tsx` consome `usePendingCodAdjustments`/`useSettleCodAdjustment` |

O caso `/line-up-tv` está replicado em três documentos vivos —
`docs/ARCHITECTURE.md:653`, `docs/RASTREABILIDADE.md:195` e
`docs/modules/operacao-suporte.md` (linhas 16, 134, 212, 216, esta última
descrevendo "`Navigate` com replace" como ação catalogada). É um comportamento
coerente e detalhado em três lugares, sustentado por um componente inexistente.

**Por que passou:** `scripts/check-docs.mjs:145` valida só um sentido — para
cada rota de `src/App.tsx`, exige uma menção no índice. Nada verifica o
inverso, nem que os caminhos `src/…` citados existam.

Estendendo a mesma checagem a **toda** a documentação viva (`docs/` menos
`archive/` e `design-audit/`), aparecem mais duas referências mortas, ambas em
catálogos de teste:

| Documento | Caminho citado | Realidade |
|---|---|---|
| `docs/modules/faturamento.md:335` | `src/components/billing/__tests__/PendenciasTable.test.tsx` | Nunca existiu. Estava numa lista de "arquivos que sustentam" filtros e emissão — ou seja, **cobertura de teste afirmada e inexistente**. A aba Pendências foi removida (`docs/modules/taxas-locais.md:96`) e a linha do teste ficou. |
| `docs/modules/viagens.md:134` | `src/components/shared/__tests__/VoyageImportActions.test.ts` | O arquivo real é `VoyageImportActions.behavior.test.tsx` |

Duas outras menções (`PendenciasFaturamentoTab.tsx` em `taxas-locais.md:96` e
`src/lib/uploadLimits.ts` em `docs/spec/README.md:106`) citam caminhos
inexistentes de forma **legítima**: ambas descrevem explicitamente a remoção ou
o rename do artefato. Não são defeito.

Recomendação: acrescentar ao `docs:check` a invariante "todo caminho
`src/…`/`supabase/…`/`scripts/…` em backticks na documentação viva existe no
disco", com uma lista curta de exceções para menções históricas declaradas.
Custo baixo, e teria pego os quatro casos acima. **Código.**

### 1.3 Superfície não indexada

- **83 das 198 RPCs expostas** não aparecem no índice. O bloco mais notável é o
  de PIX (`link_pix_reconciliation_candidate`,
  `list_pix_reconciliation_candidates`, `list_pix_reconciliation_exceptions`,
  `resolve_pix_reconciliation_exception`, `upsert_pix_reconciliation_exceptions`),
  o de notificações internas (`list_internal_notifications`,
  `mark_internal_notification_read`, `mark_all_internal_notifications_read`,
  `count_unread_internal_notifications`) e o de Vazios manual
  (`create_manual_vazios_booking`, `update_manual_vazios_booking`,
  `delete_manual_vazios_booking`).
- **15 dos 42 hooks** não são citados: `useAppSettings`, `useBilling`,
  `useBillingLedger`, `useCustomerCommunicationReadiness`,
  `useCustomerDemurrageAgreements`, `useDemurrageRates`, `usePageFilters`,
  `usePortalContactConfiguration`, `usePortalDisputes`, `usePortalNotifications`,
  `usePortalScope`, `useRoeHeaderRate`, `useRowSelection`, `useVisualTheme`,
  `useVoyageTimeline`.
- **7 tabelas** acessadas diretamente pelo frontend não são citadas:
  `customer_communication_boxes`, `customer_contact_box_links`,
  `portal_provisioning_events`, `portal_suppressed_emails`,
  `voyage_escala_operation_fronts`, `voyage_escala_revision_state`,
  `voyage_escala_terminal_state`.

**Código.**

### 1.4 Causa estrutural: parte da superfície de RPC é invisível à análise estática

`src/services/portalScope.ts:55` monta o nome da RPC em tempo de execução:

```ts
const rpcName = scope.mode === 'inspect' && !isShipSchedule
  ? `portal_inspect_${name.replace(/^portal_/, '')}`
  : name
```

Nenhuma das 11 RPCs `portal_inspect_*` aparece como literal no código. O mesmo
vale para `callReportIdAwareRpc` em `src/services/agencyDepartureReport.ts`.
Consequência prática: um índice mantido à mão **não tem como** ficar correto,
e a ausência de uma variante `portal_inspect_*` só aparece em runtime (é
exatamente o achado 3.2 abaixo). Recomendação: derivar o par
cliente/inspeção de uma tabela de constantes única, exportada, que sirva ao
mesmo tempo de fonte para o dispatcher, para o teste de contrato e para o
índice. **Código.**

---

## Vetor 2 — Código morto e RPCs fantasmas

### 2.1 Nenhum chamador aponta para RPC inexistente (lado do frontend)

Das 130 RPCs chamadas literalmente por `src/`, `supabase/functions/` e
`scripts/`, **todas as 130 existem** no schema consolidado. Não há RPC fantasma
no sentido de chamada para nome morto vindo do frontend. **Código.**

### 2.2 Edge Function órfã: `recalc-demurrage-ptax` — **P0**

`supabase/functions/recalc-demurrage-ptax/index.ts` **não é chamada por nada**:
nenhum caller em `src/`, nenhum job em `supabase/migrations/`, nenhum
workflow em `.github/`. Confirmado em produção — os 8 jobs ativos são:

```
alerts-foundation-detectors          */15 * * * *   ops.dispatch_edge_job('alerts-detector', …)
cleanup-portal-sessions              0 3 * * *
cleanup-provision-rate-limit         30 3 * * *
customer-communication-auto-runner   */15 * * * *   ops.dispatch_edge_job(…)
demurrage-dunning                    0 * * * *      ops.dispatch_edge_job(…)
portal-daily-digest                  0 11 * * *     ops.dispatch_edge_job(…)
portal-mark-expired-invites          */15 * * * *   SELECT public.portal_mark_expired_invites()
portal-refresh-general-pendencies    */15 * * * *   SELECT public.portal_refresh_general_pendencies()
```

Nenhum é `recalc-demurrage-ptax`. A tabela da ADR 0063 lista **quatro** jobs de
Edge Function e não inclui o recálculo; a migration `007_cron_secrets_no_vault.sql`
reagenda exatamente esses quatro.

**Por que isso é P0 e não faxina:** a ADR 0014 decide que "enquanto a invoice de
Demurrage não estiver paga, seu valor em BRL é recalculado a cada nova PTAX", e
nomeia a Edge Function agendada como o mecanismo — "necessária porque o portal
precisa do valor/QR atualizados mesmo sem ninguém com a página aberta". Sem
agendamento, o valor só muda quando um operador abre o modal "Informar PTAX".
O que a ADR descreve como automático é, hoje, manual. O cabeçalho da própria
Function ainda instrui a agendar pelo painel do Supabase
(`Schedule (cron) → dias úteis ~14h BRT`), o que contraria a ADR 0063 (a
configuração dos jobs é versionada e lê o Vault pelo dispatcher
`ops.dispatch_edge_job`).

O impacto está latente porque `demurrage_invoices` tem 0 linhas e
`demurrage_invoice_history` está vazia — ninguém percebeu porque não há o que
recalcular. Ele vira dinheiro errado na primeira fatura emitida.

Correção: uma migration `009` que agende
`SELECT ops.dispatch_edge_job('recalc-demurrage-ptax', 'RECALC_CRON_SECRET');`
em `0 17 * * 1-5` (UTC ≈ 14h BRT), cadastre `RECALC_CRON_SECRET` no Vault junto
com o Edge Function Secret de mesmo nome, e uma nota editorial na ADR 0063
somando o quinto job à tabela. Trocar também o comentário de cabeçalho da
Function, que hoje documenta um procedimento aposentado. **Runtime.**

### 2.3 Função quebrada: `portal_list_operation_bls_legacy` — **P2**

`portal_list_operation_bls_legacy()` chama
`public.portal_list_operation_bls_without_transshipment()`, que **não existe**
— nem no repositório nem em produção (`pg_proc` retorna 0). O que existe é
`portal_list_operation_bls_without_transshipment_legacy()` e o núcleo privado
`_portal_list_operation_bls_without_transshipment_core(bigint)`. Como plpgsql
resolve o corpo tardiamente, o `CREATE FUNCTION` passou e o erro só apareceria
na chamada. Ela é a única referência pendurada do schema inteiro (verificação
de todas as chamadas `public.X()` nos 417 corpos de função). Está morta, então
ninguém trombou — o que só reforça a remoção. **Runtime.**

### 2.4 Inventário de código morto — remoção segura

14 funções sem **nenhum** chamador (TS de produção, scripts, corpo de função
SQL, trigger ou cron) e **sem grant a `authenticated` ou `anon`** — o
fechamento da ADR 0047 está funcionando, o que torna a remoção de baixo risco:

| Função | Assinatura | Observação |
|---|---|---|
| `portal_get_current_roe_legacy` | `()` | substituída por núcleo `_portal_get_current_roe_core` + invólucro |
| `portal_get_profile_legacy` | `()` | idem |
| `portal_get_demurrage_invoice_detail_legacy` | `(p_invoice_id bigint)` | idem |
| `portal_invoice_details_legacy` | `(p_invoice_id bigint)` | idem |
| `portal_list_consolidatable_receivables_legacy` | `()` | idem |
| `portal_list_demurrage_invoices_legacy` | `()` | idem |
| `portal_list_notifications_legacy` | `(p_limit integer)` | idem |
| `portal_list_operation_bls_legacy` | `()` | **também quebrada** (2.3) |
| `portal_list_operation_bls_without_transshipment_legacy` | `()` | idem |
| `portal_list_provisioning_console_legacy` | `(p_customer_id bigint)` | idem |
| `portal_list_provisioning_events_legacy` | `(p_customer_id bigint, p_limit integer)` | idem |
| `portal_notification_unread_count_legacy` | `()` | idem |
| `close_legacy_agency_report_alerts_for_scale` | `(p_voyage_id bigint, p_port text)` | resíduo da unificação de alertas do ADR |
| `reconcile_bl_review_alerts_item` | `(p_type text, p_reason text, p_message text, p_bl_id text, p_reasons text[], p_source text)` | grant só a `service_role`, nenhum chamador |

**Não** estão nesta lista, e devem ser preservadas, as sete
`*_legacy_<NNN>` de import (`import_bl_freight_transactional_legacy_205/284/322/357`,
`import_manifest_transactional_legacy_165`,
`import_granite_manifest_transactional_legacy_136`,
`save_granite_bl_review_legacy_148`): elas formam uma cadeia viva de
sobrecarga por assinatura — `import_bl_freight_transactional` chama a `_357`,
que chama a `_322`, que chama a `_284`, que chama a `_205`. Remover qualquer
elo quebra o import.

Também **não** são mortas, apesar de não terem chamador em TS:
`portal_mark_expired_invites` e `portal_refresh_general_pendencies` (invocadas
por `cron.job`) e `rls_auto_enable` (event trigger `ensure_rls`).

**Runtime.**

### 2.5 Tabelas: nenhuma órfã

As 110 tabelas do schema têm todas ao menos um uso (frontend, corpo de função
ou policy). As 24 que não aparecem em TS são acessadas só por RPC — o que é
justamente o contrato da ADR 0004, não código morto. Nada a remover. **Código.**

### 2.6 Colunas mortas — **P3**

Seis colunas aparecem uma única vez no SQL (a própria declaração) e em nenhum
lugar do código:

| Coluna | Situação |
|---|---|
| `alerts.notified_at` | nullable, nunca escrita nem lida — **morta** |
| `bls.consignee_address` | nullable, nunca escrita nem lida — **morta** |
| `charge_calculations.reviewed_at` | nullable, nunca escrita nem lida — **morta** |
| `customer_portal_sessions.last_seen_at` | nullable, nunca escrita nem lida — **morta** |
| `ended_vessels.ended_at` | `DEFAULT now() NOT NULL` — write-only, escrita e jamais lida |
| `portal_email_events.received_at` | `DEFAULT now() NOT NULL` — write-only, escrita e jamais lida |

As quatro primeiras podem cair. As duas últimas são baratas e plausivelmente
úteis em investigação futura; a decisão aqui é registrar, não necessariamente
remover. `bls.consignee_address` merece uma olhada de domínio antes: pode ser
campo de documento que o parser deveria estar preenchendo e não preenche.
**Código.**

### 2.7 `src/types/database.ts` divergiu do schema — **P1**

O arquivo gerado (protegido por `.claude/hooks/protect-files.sh`) está fora de
sincronia com o schema consolidado nos dois sentidos:

- **55 RPCs expostas ausentes do tipo**, das quais **18 são efetivamente
  chamadas pelo app** — entre elas `list_alert_queue_page`,
  `list_internal_notifications`, `summarize_alert_queue_by_department`,
  `upsert_billing_alert`, `resolve_billing_alert`, `dismiss_alert_item`,
  `complete_review_customer_group`, `portal_open_inspection`,
  `refresh_customer_reconciliation_queue_for_bl`, `reopen_demurrage_dispute`.
- **6 RPCs declaradas que não existem** no schema: `can_edit_customers`,
  `can_edit_depots`, `can_edit_voyages`, `is_active_non_equipamentos_user`,
  `is_equipamentos_user`, `portal_list_operation_bls_without_transshipment`.
  As cinco primeiras foram removidas pelas ADRs 0044/0046/0060 (o teste
  `src/integration/rpcFinalDefinition.local-pg.test.ts:137` inclusive afirma que
  `can_edit_voyages` não deve existir após o replay); a sexta é a mesma função
  fantasma do achado 2.3.
- **Assinatura errada:** `settle_cod_adjustment` está declarada como
  `{ p_adjustment_id: number; p_actor?: string }`, mas a função real é
  `(p_adjustment_id bigint, p_actor uuid, p_resulting_document_id bigint,
  p_resulting_document_type text)`.

O custo já é visível: pelo menos três `as unknown as` no código de produção
existem só para contornar isso —
`src/services/billingLedger.ts:212`, `src/services/transshipments.ts:108`,
`src/services/portalScope.ts:40`. Cada um é um ponto onde o TypeScript deixou
de proteger a chamada.

Correção: regenerar `src/types/database.ts` contra o schema v1.0 (operação que
exige autorização explícita pelo hook de proteção) e remover os três adapters.
**Código + Runtime.**

---

## Vetor 3 — Inspeção dos comentários `ponytail:`

37 comentários `ponytail:` vivos (fora de `docs/archive/` e
`supabase/migrations_archive/`): 15 em `src/services`, 5 em `src/hooks`,
5 em `src/components`, 3 em `src/lib`, 3 em `supabase/migrations`,
2 em `src/pages`, mais `src/test`, `supabase/functions`, `scripts` e docs.

**Nenhum teto declarado foi atingido** — a operação tem 0 B/Ls, 0 invoices e
0 faturas de Demurrage. A tabela abaixo prioriza por *distância até o teto*:
quanto volume falta para cada atalho começar a doer.

### 3.1 Prontos para upgrade agora (o gatilho já disparou, independe de volume)

| Local | Situação |
|---|---|
| `src/components/bl/BlOperacionalTab.tsx:70` | **Obsoleto.** O comentário diz que `notify2_block` e `consignee_phone` "are not in generated database.ts yet" — mas os dois estão lá (`src/types/database.ts:942` e `:967`, no `Row` de `bls`). O cast `bl as BLDetail & {…}` pode sair junto com o comentário. |
| `src/pages/EmbarqueVazios.tsx:71` | **Gatilho disparado.** O upgrade é condicionado a "quando `docs/plans/2026-07-31-escala-unificada-pol-pod.md` for entregue" — o plano foi entregue e está em `docs/archive/plans/`. `docs/plans/` hoje só tem `README.md`. O caminho citado no comentário nem existe mais. |
| `src/services/agencyDepartureReport.ts:812` | Mesma duplicação, do outro lado: reimplementa a união `bls.pod`/`bls.pol` normalizada que `fetchVoyageEscalaPorts` faz. A justificativa registrada ("os dois planos são deliberadamente independentes") caducou com a entrega do plano de escala unificada. Os dois devem convergir para a projeção única na mesma mudança. |

### 3.2 Tetos que chegam cedo (volume baixo já basta)

| Local | Teto declarado | Quando dói |
|---|---|---|
| `src/services/customerCommunications.ts:682` e `src/services/customerContactConfiguration.ts:44` | Supressões filtradas por e-mail porque o full-scan estourava `max_rows=1000` | **Já estourou uma vez** — o comentário registra que "a conferência mentia". A mitigação atual é filtro no cliente; o upgrade nomeado (RPC com filtro server-side) continua pendente. Volta a doer quando um único cliente tiver >1000 contatos supressos. É o único ponytail do repositório que documenta um teto **já atingido no passado**. |
| `src/hooks/useBls.ts:99` | Materializa todos os B/Ls e containers no cliente (`O(tabela)`) para preservar filtros derivados | Primeiro a quebrar. Cada B/L traz seus containers; alguns milhares de B/Ls já significam dezenas de milhares de linhas por render da tela de Manifestos. Upgrade nomeado: agregação e filtros server-side. |
| `src/pages/Painel.tsx:52` | Snapshot cobre só as 60 viagens mais recentes | 36 viagens hoje. Passa de 60 dentro de meses de operação e o Painel silenciosamente para de mostrar histórico — sem erro, sem aviso. |
| `src/components/portal/PortalBillingTabs.tsx:36` e `:153` | Paginação client-side das faturas do Portal | Por cliente, não global — dói tarde, mas o mesmo trecho está duplicado em dois lugares, então o upgrade (`p_limit`/`p_offset` nas RPCs) precisa tocar os dois. |

### 3.3 Tetos distantes — registrar e deixar quieto

`src/hooks/useTransshipments.ts:21` (1+N por viagem aberta, hoje 0–1 omissão por
viagem), `src/services/alerts.ts:608` (uma consulta por tabela, página de 100),
`src/services/ladenOnBoardAtd.ts:41` (loop sequencial por consistência de
auditoria), `supabase/migrations/007:71` (uma leitura de cofre por disparo,
quatro por hora no pior caso), `src/lib/zipEntry.ts:7` (sem Zip64; teto de
65535 entradas ou 4 GB), `src/services/portCode.ts:6` (lookup UN/LOCODE à mão),
`src/services/blParser.ts:84` (acoplado ao layout COSCO Page 1).

### 3.4 Dívida estrutural, não de volumetria

| Local | Por que merece atenção separada |
|---|---|
| `src/test/setup.ts:4` | A ponte do squash v1.0 faz 201 testes `*Migration.test.ts` auditarem `supabase/migrations_archive/` em vez do schema aplicado. A própria ADR 0062 aceita o custo explicitamente e nomeia os dois gates que cobrem o artefato ativo (`verificar_guardas.py` e `consolidatedSchemaInvariants.test.ts`). **Esta auditoria é evidência de que os dois gates não são suficientes:** os achados 2.2, 2.3, 2.7 e o 4.1 abaixo passaram por eles. A dívida é real e está subvalorizada. |
| `src/services/voyageRouteSchedules.ts:627` | `entity_type` permanece `voyage_pod_schedule` "por compatibilidade histórica"; o upgrade nomeado é promover a escala a tabela própria "como previsto na ADR 0027". O acoplamento vaza para leitura: `src/services/voyageTimeline.ts:49` filtra por esses literais. Divergência viva entre uma ADR aceita e a persistência. |
| `src/services/billingLedger.ts:212` | Comentário **correto e ainda válido** — mas a causa (tipos desatualizados) é o achado 2.7, que é maior do que este adapter. Resolver 2.7 apaga este ponytail e mais dois. |
| `src/lib/portalCnpjLogin.ts:10` | Não valida dígito verificador porque `customers.cnpj_cpf` carrega documentos de teste que não fecham DV. Teto de **dados**, não de volume: some quando a base for limpa para produção — e a base está vazia, então a janela para fechar isso é agora. |

---

## Vetor 4 — Aderência aos ADRs aceitos

### 4.1 ADR 0047 e ADR 0011 — grant a `PUBLIC` sobrevivente — **P0**

`public.upsert_portal_invoice_exception(p_invoice_id bigint, p_bl_id text)`,
`SECURITY DEFINER`, `RETURNS void`, tem em produção:

```
proacl = {=X/postgres,postgres=X/postgres,service_role=X/postgres}
```

O `=X` inicial é o grant a **`PUBLIC`**. Consequência:
`has_function_privilege('anon', …, 'EXECUTE')` retorna `true`, e como a função
não retorna `trigger`, o PostgREST a expõe — uma requisição não autenticada com
a chave `anon` pode invocá-la.

A ADR 0011 revoga `anon` de `SECURITY DEFINER` e a ADR 0047 estabelece grants
fechados por padrão. Esta função é a **única** exceção callable no schema
inteiro: das 12 funções que `anon` pode executar em produção, 11 retornam
`trigger` (inertes via PostgREST) e esta é a décima segunda.

**Não é drift de produção — é defeito do repositório.** A migration
`002_business_logic_and_security.sql:22638` cria a função e nunca emite o
`REVOKE ALL … FROM PUBLIC` que todas as funções irmãs recebem. A migration
`006` fecha o buraco só para o futuro (`ALTER DEFAULT PRIVILEGES … REVOKE
EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated` só afeta funções criadas
**depois**). Replayar o repositório num banco limpo reproduz o mesmo furo.

Efeito prático: a função grava/resolve o alerta
`portal_excecao_critica_fatura` via `block521_upsert_alert` /
`block521_resolve_alert` para um par `(invoice_id, bl_id)` arbitrário. Pela ADR
0054 o Portal é o gate de faturamento, e esse alerta é o sinal de exceção do
gate — um chamador anônimo pode poluí-lo ou silenciá-lo.

Correção: migration `009` com
`REVOKE ALL ON FUNCTION public.upsert_portal_invoice_exception(bigint, text)
FROM PUBLIC, anon, authenticated;` (a função só é usada por triggers, que rodam
como `postgres`/definer — nenhum grant externo é necessário). Estender o mesmo
REVOKE às 10 funções de trigger com `=X` por higiene. E, mais importante:
`scripts/security/verificar_guardas.py` e
`src/services/__tests__/consolidatedSchemaInvariants.test.ts` — os dois gates
que a ADR 0062 nomeia como cobertura do artefato ativo — **não pegaram isto**.
Vale acrescentar a invariante "nenhuma função não-trigger em `public` mantém
grant a `PUBLIC`" a um deles. **Runtime.**

### 4.2 ADR 0045 — paridade cliente/inspeção quebrada — **P1**

A ADR 0045 estabelece que cada leitura escopada por Cliente tem um núcleo
privado e dois invólucros (`portal_*` e `portal_inspect_*`) que delegam ao mesmo
núcleo, e que "nenhuma RPC `portal_inspect_*` é criada para escritas".

`portal_list_disputes()` é uma **leitura** e não segue o padrão:

- não tem núcleo `_portal_list_disputes_core`;
- não tem invólucro `portal_inspect_list_disputes` — confirmado ausente em
  produção (`pg_proc` retorna 0) e em todo o repositório;
- resolve o cliente direto por `current_portal_customer_id()`
  (`002_business_logic_and_security.sql:12522`).

Mas `src/services/portalBilling.ts:214` a chama por `callPortalRpc(scope, …)`,
e `portal_list_disputes` **não** está em `portalWriteRpcNames`
(`src/services/portalScope.ts:18`) — logo não é barrada como escrita. Em modo
inspeção o dispatcher monta `portal_inspect_list_disputes` e a chamada falha
com `PGRST202`.

O caminho é alcançável: `src/hooks/usePortalDisputes.ts:12` traz
`enabled: isAuthenticated || scope.mode === 'inspect'` — habilitação explícita
para inspeção — e `PortalBilling` está montada em
`/clientes/portal/inspecao/:customerId/billing` (`src/App.tsx:163`).
Resultado: a aba de faturamento da Inspeção do Portal erra ao carregar
disputas. Não apareceu ainda porque `demurrage_disputes` tem 0 linhas e a
Inspeção provavelmente nunca foi exercitada contra um cliente com disputa.

Correção: extrair `_portal_list_disputes_core(p_customer_id bigint)` e criar os
dois invólucros, como as outras 11 leituras. Um teste de contrato que compare
`portalWriteRpcNames` ∪ {leituras com variante} contra os nomes efetivamente
passados a `callPortalRpc` fecharia a classe inteira desse bug. **Runtime.**

### 4.3 ADR 0046 — trilha de auditoria fora da transação — **P2**

A ADR 0046 libera a escrita interna a todo departamento e move o controle para
"o rastro obrigatório: toda escrita registra autor e Departamento congelado no
instante do evento", tornando a auditoria "caminho crítico da escrita".

`src/services/baplieReconciliation.ts:343-368` (`applyBapliePhysicalFlags`) é a
**única** escrita de `audit_logs` feita pelo cliente em todo o frontend — as
outras 56 acontecem dentro de funções SQL, na mesma transação da mudança. Ali:

1. `UPDATE bl_containers` e `INSERT audit_logs` são duas chamadas HTTP
   separadas, sem transação — falha na segunda deixa a mudança sem rastro;
2. o resultado do insert **não é verificado** (`await supabase.from('audit_logs').insert({…})`
   sem checar `error`), enquanto o update logo acima faz `if (error) throw error`;
3. `actor_role` e `actor_department` não são gravados, embora a ADR exija
   "autor e Departamento congelado";
4. `changed_by` vem de um `actorId` fornecido pelo cliente — forjável, ao
   contrário do `auth.uid()` que as RPCs usam.

Correção: mover a operação para uma RPC transacional, no mesmo molde das
outras escritas auditadas. **Código.**

### 4.4 ADR 0003 — acesso a Supabase fora de `services/` — **P3**

A ADR 0003 define que `services/` "concentra acesso a Supabase, RPCs, parsers,
regras de domínio testáveis". Onze páginas e componentes importam
`services/supabase` — dez legitimamente, só para `supabase.auth` (login,
recuperação de senha, ativação do Portal). A exceção real é uma:

`src/pages/Baplie.tsx:64` executa
`supabase.from('baplie_containers').select('voyage_id')` direto na página.
Uma linha, sem serviço intermediário. **Código.**

### 4.5 ADRs verificados sem divergência

- **ADR 0004** (RLS/RPC como fronteira): as 24 tabelas sem acesso em TS são
  alcançadas só por RPC — é o contrato funcionando, não código morto.
- **ADR 0013** (exceção `anon`): `portal_ship_schedule` é a única RPC de negócio
  com grant a `anon`, exatamente como decidido.
- **ADR 0016** (nomenclatura numerada sequencial): `001`–`008` sem lacuna.
- **ADR 0047** (grants fechados): 14 das 14 funções mortas estão sem grant
  externo. Só o caso 4.1 escapa.
- **ADR 0062** (squash v1.0): as 110 tabelas do repositório batem com as 110 de
  produção.

---

## Plano de remediação sugerido

| Ordem | Ação | Achado |
|---|---|---|
| 1 | Migration `009`: `REVOKE … FROM PUBLIC` em `upsert_portal_invoice_exception` (+ as 10 de trigger) e invariante nova em `consolidatedSchemaInvariants.test.ts` | 4.1 |
| 2 | Migration `009`: agendar `recalc-demurrage-ptax` por `ops.dispatch_edge_job`, cadastrar `RECALC_CRON_SECRET`, nota editorial na ADR 0063, corrigir o cabeçalho da Function | 2.2 |
| 3 | Núcleo + invólucros para `portal_list_disputes`; teste de contrato cobrindo todos os nomes passados a `callPortalRpc` | 4.2 |
| 4 | Regenerar `src/types/database.ts` (requer autorização do hook) e remover os três `as unknown as` | 2.7 |
| 5 | Migration: `DROP` das 14 funções mortas | 2.3, 2.4 |
| 6 | RPC transacional para `applyBapliePhysicalFlags` | 4.3 |
| 7 | Atualizar `RASTREABILIDADE.md`: contagens, linhas 189 e 400, RPCs/hooks/tabelas ausentes | 1.1–1.3 |
| 8 | Convergir `EmbarqueVazios`/`agencyDepartureReport` na projeção unificada; remover o ponytail obsoleto de `BlOperacionalTab` | 3.1 |
| 9 | `DROP` das 4 colunas mortas; mover a consulta de `Baplie.tsx:64` para um serviço | 2.6, 4.4 |

## Correções aplicadas nesta mudança

O contrato de documentação do `CLAUDE.md` manda corrigir o documento vivo
quando ele diverge do repositório executável. Foram aplicadas apenas as
correções **factuais e verificáveis** do vetor 1; nenhum código foi alterado.

| Arquivo | Correção |
|---|---|
| `docs/RASTREABILIDADE.md` | Cabeçalho: contagens atualizadas (130 RPCs literais, 62 tabelas, 15 Edge Functions), com a ressalva de que 83 das 198 RPCs expostas ainda não têm linha e de que os nomes `portal_inspect_*` são montados em runtime; data de verificação para 2026-09-06 |
| `docs/RASTREABILIDADE.md` | Linha `/line-up-tv`: descrita como catch-all de `src/App.tsx`, sem componente próprio |
| `docs/RASTREABILIDADE.md` | Linha `cod_adjustments`: `src/services/codAdjustments.ts` → `src/hooks/useBillingLedger.ts` + `src/services/billingLedger.ts` |
| `docs/ARCHITECTURE.md` | Linha `/line-up-tv` da tabela de rotas |
| `docs/modules/operacao-suporte.md` | Anatomia, catálogo de ações e prosa de `/line-up-tv` |
| `docs/modules/faturamento.md` | Removida a linha do teste inexistente `PendenciasTable.test.tsx` |
| `docs/modules/viagens.md` | `VoyageImportActions.test.ts` → `VoyageImportActions.behavior.test.tsx` |

**Deliberadamente não corrigido aqui:** as 83 RPCs, 15 hooks e 7 tabelas fora
do índice (volume que merece mudança própria), e tudo dos vetores 2, 3 e 4 —
são mudanças de código e de schema, não de documentação.

## Limites desta auditoria

- A análise de chamadas é estática e por nome; nomes montados em runtime
  (`portal_inspect_*`, `callReportIdAwareRpc`) foram tratados à mão. Um nome
  montado que eu tenha deixado passar apareceria falsamente como código morto —
  por isso cada item do inventário de remoção foi confirmado também contra o
  catálogo de produção.
- A verificação Runtime cobre catálogo, ACLs, agendamentos e contagens. **Não**
  houve execução de RPC, teste de RLS sob sessão real, nem validação de
  comportamento de PostgREST — a exposição descrita em 4.1 foi derivada de
  `proacl` e do tipo de retorno, não de uma requisição HTTP.
- Volumetria zerada impede afirmar que qualquer teto de `ponytail:` está
  próximo. As prioridades do vetor 3 são projeções, não medições.
