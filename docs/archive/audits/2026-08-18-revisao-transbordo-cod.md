# Revisão de arquitetura, UI/UX e regra de negócio — Transbordo e COD

> **Status:** histórico · **Data:** 2026-08-18 · **Escopo:** Omissão de Escala,
> Transbordo, COD e seus efeitos em Viagens, ficha do B/L, ADR, Line-Up, Portal
> e Taxas Locais.

Registro do confronto entre a documentação vigente e o código executável, e das
decisões tomadas na entrevista que o acompanhou. O plano de correção derivado
está em [`docs/plans/2026-08-18-transbordo-cod-correcoes.md`](../../plans/2026-08-18-transbordo-cod-correcoes.md);
a decisão de negócio que ele implementa está na
[ADR 0051](../../adr/0051-cod-reprecifica-no-destino-final.md).

## 1. Método

Leitura da documentação vigente (`CONTEXT.md`, ADR 0022, ADR 0038,
`docs/RASTREABILIDADE.md`, `docs/modules/viagens.md`, spec arquivada de
2026-07-09 e plano WS3 de 2026-07-16), seguida de leitura do código de
`src/services/transshipments.ts`, `src/hooks/useTransshipments.ts`, dos
componentes de Viagens/B/L/Portal e das migrations `174`, `175`, `176`, `177`,
`201`, `202`, `206`, `215`, `274`, `292` e `295`.

Caso de referência usado em toda a revisão: **CHASE V.1** (POLs
QINGDAO/TAICANG/NANSHA/NINGBO → PODs Salvador e Vitória), o mesmo da spec
original. O armador omite Salvador; a carga desce em Vitória; um B/L vira COD.

## 2. Achados

Ordenados por severidade. Cada achado traz a evidência e o rótulo de prova
conforme [`docs/CONVENCOES.md`](../../CONVENCOES.md).

### P0-1 — A migration `215` descarta os dados de transbordo capturados na omissão

A migration `201` implementou a captura inicial do registro global
(`onward_vessel_name`, `onward_carrier`, `onward_voyage_number`, `onward_etd`,
`onward_eta`) no `INSERT` de `voyage_omissions`. A migration `215` recriou
`omit_voyage_escala` a partir do corpo da `174`/`206`: manteve os parâmetros
`p_onward_*` na assinatura, mas o `INSERT`/`ON CONFLICT` voltou a gravar apenas
`voyage_id, omitted_pod, discharge_pod, reason, omitted_by`.

`215` é a última definição da função — `omit_voyage_escala` só aparece em `174`,
`177`, `201`, `206` e `215`, e o repositório vai até a `305`.

Efeito: o fieldset "Dados de transbordo (complete quando conhecidos)" de
`src/components/voyages/OmitEscalaModal.tsx` é decorativo. O operador preenche
navio, armador, viagem, ETD e ETA, confirma, recebe sucesso e os dados não
existem. É preciso reabrir a Viagem e redigitar tudo em **Complementar**.

- **Evidência:** **Código** — `supabase/migrations/215_rbac_voyages_customers_writes.sql`

### P0-2 — A migration `215` rebloqueia a omissão de escala única

A migration `177` (issue #355) existe exclusivamente para permitir que uma
viagem de POD único seja omitida: derrubou o `CHECK` da tabela e o guard
`v_omitted = v_discharge` da RPC. A `201` manteve removido. A `215`
reintroduziu `OR v_omitted = v_discharge`.

O front oferece justamente esse caminho: quando há um só POD ativo,
`candidateDischargePods` passa a ser o próprio POD omitido. O usuário só pode
escolher a opção que a RPC recusa, e a tela mostra apenas
`Falha ao omitir a escala.`

- **Evidência:** **Código** — `supabase/migrations/177_allow_single_pod_omission.sql`,
  `supabase/migrations/215_rbac_voyages_customers_writes.sql`,
  `src/components/voyages/VoyageCard.tsx:467`

### P0-3 — Os testes de contrato SQL não enxergam o schema composto

Os testes de contrato deste fluxo são expressões regulares sobre **um arquivo de
migration específico**:

```ts
const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/201_voyage_omission_global_transshipment.sql')
```

O arquivo `201` continua correto, então o teste passa indefinidamente mesmo com
a `215` desfazendo o comportamento. `transshipments.test.ts` prova apenas o lado
cliente — que os `p_onward_*` são **enviados** —, nunca que são **gravados**.

É a causa-raiz estrutural de P0-1 e P0-2: nenhuma verificação observa a
definição final de uma função depois de todas as migrations.

- **Evidência:** **Código** — `src/services/__tests__/voyageOmissionGlobalMigration.test.ts`,
  `src/services/__tests__/transshipments.test.ts`

### P1-4 — A omissão é irreversível

Não existe RPC nem superfície para desfazer uma omissão. Não há gravação de
`omitted = 'false'`, `DELETE FROM voyage_omissions` nem função de restauração.

Um clique no ícone de alerta da linha errada seguido de confirmação no modal:
marca a escala, cria as disposições e **dispara notificação para todos os
clientes daquele porto**. A saída é correção manual no banco. Nenhum documento
declara essa irreversibilidade.

- **Evidência:** **Código** — busca exaustiva em `supabase/migrations/` e `src/`

### P1-5 — O Line-Up interno ignora escala omitida

`src/services/lineup.ts` monta `routePods` a partir dos B/Ls e das escalas com
dados e nunca filtra `omitted`, embora `listVoyageEscalaSchedulesByVoyageIds` já
entregue a flag e `useOmitEscala` invalide `['lineup-tv-v3']` e
`['lineup-tv-display-v2']` como se filtrasse.

Como escala omitida nunca recebe ATA/ATD, ela permanece indefinidamente no
painel como chegada pendente — o modo de falha que a §4 da spec de 2026-07-09
foi escrita para evitar. A spec listou três pontos de leitura
(`getProximaEscala`, conclusão automática da viagem e `portal_ship_schedule`);
o Line-Up não estava entre eles e nunca foi coberto.

- **Evidência:** **Código** — `src/services/lineup.ts:128-205`

### P1-6 — COD reescreve `bls.pod`, o motor de taxas lê `bls.pod`, e nada dispara o recálculo

`calculate_bl_local_charges` (última definição: migration `274`) resolve a
tabela por `resolve_local_charge_table_id(v_bl.cargo_mode, v_bl.pod, v_ref_date)`
e a Data de Referência por `pod_schedule_snapshot -> v_bl.pod ->> 'eta'`.
`set_bl_cod` reescreve `bls.pod` e **não dispara recálculo nenhum**.

Quem dispara recálculo é o botão "Recalcular" da Validação, as importações
(B/L, veículos, breakbulk) e o gate de CE (`reviewBillingAutomation.ts:35`).
Resultado: se ninguém tocar no B/L depois do COD, a taxa fica no porto antigo;
se alguém reimportar, ela migra sozinha. **O mesmo COD produz dois resultados
financeiros conforme o que acontecer depois** — nem a regra documentada (ADR
0038 dec. 1: COD não reprecifica) nem a regra desejada é aplicada de fato.

A ADR 0051, decidida nesta revisão, inverte a regra documental: a taxa local
segue o destino final. Este achado deixa de ser divergência com a ADR 0038 e
passa a ser a lacuna de implementação da 0051.

- **Evidência:** **Código** — `supabase/migrations/274_charge_table_validity_is_informational.sql`,
  `supabase/migrations/215_rbac_voyages_customers_writes.sql`,
  `src/services/reviewBillingAutomation.ts:35`

### P1-7 — A rota desviada por omissão não é exibida em lugar nenhum

`buildVoyageManifestRows` monta `routeLabel` como `POL -> POD`
(`voyageCardHelpers.tsx:113`), sem noção de omissão. Depois de omitir Salvador,
a aba Manifestos continua exibindo `QINGDAO -> SALVADOR` como se a carga fosse
descarregar lá.

Consequência prática: quando um B/L sofre COD e migra para uma rota sem CE
Master cadastrado, a coluna passa a mostrar `-`
(`VoyageManifestosTab.tsx:118`), sem nada indicando que falta informar o número
do manifesto do novo destino.

- **Evidência:** **Código** — `src/components/voyages/voyageCardHelpers.tsx:113`,
  `src/components/voyages/VoyageManifestosTab.tsx:118`

### P2-8 — O Portal exibe dados de navio de transbordo para B/L em COD

`PortalTransshipmentCard` recebe `disposition` e a ignora. O cliente que pediu
COD — cuja carga fica no porto de descarga e não tem perna adiante — vê navio,
armador, viagem, ETD e ETA de um transbordo que, para ele, não existe.

- **Evidência:** **Código** — `src/pages/PortalOperacao.tsx:479-497`

### P2-9 — Datas cruas e motivo interno na tela do cliente

No mesmo card, `onward_etd`/`onward_eta` são `TIMESTAMPTZ` renderizados
diretamente, sem formatação (ex.: `2026-08-20T00:00:00+00:00`), enquanto o card
interno `TransshipmentInfoCard` formata em pt-BR. E o **Motivo** da omissão —
texto livre digitado pelo operador — é publicado integralmente ao cliente.
Nenhum documento decidiu publicá-lo; a §7 da spec previa apenas as duas
mensagens de notificação.

- **Evidência:** **Código** — `src/pages/PortalOperacao.tsx:486-493`,
  `src/services/portalOperation.ts:97-114`

### P2-10 — COD sem confirmação e sem justificativa

O clique chama `setCod.mutate` diretamente. Sem diálogo, sem campo de
justificativa. A ação reescreve o POD do B/L e notifica o cliente. A
justificativa gravada em `audit_logs` é a literal fixa da RPC
(`'COD apos omissao da escala de X'`), enquanto a §8 da spec classificava COD
como ato deliberado com justificativa, contando como Auditoria.

- **Evidência:** **Código** — `src/pages/BlDetalhe.tsx:203`

### P2-11 — Reverter COD não notifica o cliente

`set_bl_transshipment` restaura `bls.pod` e audita, mas não insere
`portal_notifications`. O cliente que recebeu "Destino alterado (COD)" nunca
recebe a correção.

- **Evidência:** **Código** — `supabase/migrations/215_rbac_voyages_customers_writes.sql`

### P2-12 — Três afirmações falsas na documentação viva

| Documento | Afirma | Realidade |
|---|---|---|
| `docs/RASTREABILIDADE.md:290` | `set_bl_cod`/`set_bl_transshipment` exigem `can_edit_voyages()` | A migration `295` (ADR 0046) reescreveu os corpos trocando por `is_active_user()` e dropou a função |
| `docs/modules/viagens.md:54` | Omitir escala é ação de **Admin** | `canEditVoyages = Boolean(profile || user)` — qualquer usuário autenticado |
| `docs/modules/viagens.md:54` | A omissão captura navio, armador, viagem, ETD e ETA no registro global | Falso desde a migration `215` (ver P0-1) |

- **Evidência:** **Código** — `supabase/migrations/295_internal_writes_global.sql:97-126`,
  `src/components/voyages/VoyageVisaoTab.tsx:62`

### P3 — Ruídos estruturais

- **Dois cards para o mesmo dado.** `TransshipmentInfoCard` (aba Visão) e
  `TransshipmentPanel` (fora das abas, sempre visível ao pé do card da Viagem)
  exibem o mesmo registro global com vocabulário divergente:
  "Porto de Transbordo — VITORIA" contra "descarga em VITORIA". O `CONTEXT.md`
  canonizou **Porto de Transbordo**.
- **Colunas mortas.** `bl_transshipments.onward_*` não são escritas por nada
  desde a `201`, mas seguem no schema, no `SELECT` do serviço, no tipo
  `BlTransshipment` e nos testes.
- **`update_voyage_omission` sempre audita**, mesmo sem mudança, e sobrescreve
  `reason` com `NULL` quando o campo é enviado vazio. Cada gravação polui a
  Linha do Tempo da Viagem.
- **Escala só de exportação não pode ser omitida** — o botão é condicionado a
  `row.temImportacao`. Nenhum documento decidiu isso.
- **Fallback por porto na ficha do B/L.** `useBlCockpit.ts:23` resolve a omissão
  por `omittedPod === bl.pod` quando não há `bl_transshipments`. Como a operação
  confirmou que não existe a hipótese de B/L chegar depois da omissão, o
  fallback não é rede de segurança: ele desenha o card e habilita "Marcar COD"
  para um vínculo inexistente, e a RPC recusa com
  `Transbordo do B/L X nao encontrado`.

## 3. Decisões tomadas na entrevista

Registradas aqui como histórico; a decisão arquitetural formal está na ADR 0051.

| # | Decisão |
|---|---|
| 1 | **A Taxa Local segue o destino final.** COD reprecifica; transbordo não, porque o destino final é preservado. Inverte a decisão 1 da ADR 0038. |
| 2 | **Reprecificação por estado financeiro:** não faturado recalcula na hora; faturado e não pago cancela e reemite; faturado e pago gera Fatura Complementar de COD (a cobrar) ou restituição via `invoice_refunds` (a devolver). |
| 3 | **A emissão do ajuste é ato do Financeiro.** O COD calcula e registra a diferença; não emite documento nem devolve dinheiro. |
| 4 | **Reverter COD é simétrico** e segue as mesmas regras por estado. |
| 5 | **A omissão passa a ser reversível por Admin**, com justificativa obrigatória e notificação de correção ao cliente — bloqueada enquanto houver qualquer B/L em COD naquela omissão. |
| 6 | **Omitir o mesmo POD duas vezes passa a ser erro**, não `ON CONFLICT DO UPDATE` silencioso. |
| 7 | **Escala omitida aparece no Line-Up com chip "Omitida"**, fora das contagens de pendência. |
| 8 | **O CE Mercante do B/L nunca muda.** O manifesto (CE Master) também não muda de identidade nem de número — mas um B/L em COD **é transferido** para o manifesto do novo destino. Se essa rota não existir, ela nasce sem manifesto e vira pendência visível. |
| 9 | **A rota afetada por omissão passa a ser exibida com o desvio** (`QINGDAO → ~~SALVADOR~~ → VITÓRIA`) e badge OMISSÃO. |
| 10 | **Portal:** card próprio para COD sem campos de navio, datas em pt-BR, motivo da omissão removido da tela do cliente. |
| 11 | **COD exige confirmação e justificativa**, gravada em `audit_logs`. |
| 12 | Promover o **manifesto a entidade própria** (cancelamento e consolidação de CEs entre manifestos) fica **fora** deste escopo, com entrevista própria. |

## 4. Hipótese descartada durante a revisão

Foi levantada, e depois **descartada**, a hipótese de que `bls.pod` acumulava
dois papéis incompatíveis — rota documental (que governaria CE Mercante e CE
Master) e destino final operacional. A regra confirmada pela operação desfaz a
hipótese: um B/L em COD **realmente muda de manifesto**, então `bls.pod` tem um
papel só, e todos os seus consumidores querem exatamente o destino final. O
comportamento atual de `set_bl_cod` está correto nesse ponto; o que falta é
torná-lo visível (P1-7) e completá-lo no financeiro (P1-6).

O registro fica aqui porque a hipótese custou uma rodada de entrevista e pode
ressurgir: quem a reencontrar deve saber que ela foi examinada e recusada por
fato de domínio, não por conveniência.

## 5. Não observado

- Não há CODs nem transbordos em produção — confirmado pela operação. Nenhum
  backfill, migração de dados ou relatório de casos legados é necessário.
- Demurrage não é afetado: `demurrageRates.ts` resolve tarifa e free time sem
  consultar `bls.pod`, que aparece apenas em exibição e na fatura.
- O ADR (`agencyDepartureReport.ts:486`) já conta a carga em transbordo pelo
  porto de descarga real, separada do destino final daquele porto, exatamente
  como o `CONTEXT.md` descreve. Nenhuma correção necessária.
- `portal_ship_schedule` (migrations `175` e `277`) exclui corretamente PODs
  omitidos da Programação do Portal.
- A migration `292` preservou a extensão de transbordo de
  `portal_list_operation_bls` ao reescrevê-la via `pg_get_functiondef`; não há
  regressão análoga à da `215` nesse caminho.
