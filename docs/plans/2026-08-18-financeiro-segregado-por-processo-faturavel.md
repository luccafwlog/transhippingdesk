# Financeiro segregado por processo faturável

**Goal:** Reorganizar o módulo Financeiro em três páginas de primeiro nível —
**Taxas Locais**, **Demurrage** e **Conciliação PIX** —, com o cadastro de
tabelas descendo para sub-rota, e mover **Relatórios** para fora do dropdown
Financeiro. Nenhuma regra de cálculo, emissão, pagamento ou autorização muda.

**Architecture:** A rota `/taxas-locais` passa a servir a tela que hoje é
`/faturamento` (Validação + Invoices), e o cadastro atual de tabelas/overrides
desce para `/taxas-locais/tabelas`. Isso alinha o módulo ao padrão já existente
no repo — operação na rota pai, cadastro na filha (`/demurrage` →
`/demurrage/taxas`, `/granito` → `/granito/taxas`, `/embarquevazios` →
`/embarquevazios/depots`). Taxas Locais era a única exceção: expunha o cadastro
como se fosse a operação.

**Tech Stack:** React + TypeScript, React Router, TanStack Query, Vitest,
Supabase (uma migration de texto de mensagem).

## Modelo acordado

A empresa tem **dois processos faturáveis**, com departamentos donos distintos:

| Processo | Departamento dono | Rota | Cadastro |
|---|---|---|---|
| Taxas Locais | Documentação | `/taxas-locais` | `/taxas-locais/tabelas` |
| Demurrage | Equipamentos | `/demurrage` | `/demurrage/taxas` |

Ambos tratam faturas; o menu passa a segregar **por natureza da cobrança**, não
por etapa do processo. "Faturamento" some como nome de tela porque descrevia uma
etapa comum aos dois — e, na prática, servia só a um deles.

**A linguagem de domínio já estava correta; a interface é que tinha derivado.**
`CONTEXT.md` define **Taxas Locais** como "cobranças ligadas ao B/L" (o processo
faturável, dentro da seção Faturamento) e **Tabela de Taxas Locais** como o
"cadastro que define quais taxas locais existem e quanto custam" — e diz
explicitamente que a tabela "tem a mesma natureza da Tarifa de Demurrage". A
tela chamada "Taxas Locais" mostrava o cadastro, ou seja, usava o nome do
processo para nomear a tabela. A restruturação **não renomeia conceito nenhum**:
faz a UI obedecer o vocabulário que já está escrito.

## Decisões (grilling de 2026-08-18)

1. `/taxas-locais` serve a tela de faturamento; tabelas descem para
   `/taxas-locais/tabelas`. `/taxaslocais` sem hífen foi descartado: duas URLs
   quase idênticas para telas diferentes.
2. "Tabelas" é **sub-rota**, não modal — a tela tem estado endereçável (aba,
   POD, modo de carga, busca de cliente) e é alvo de deep link.
3. Documentação viva realinhada + ADR novo registrando a segregação.
4. Relatórios vira botão de primeiro nível **logo depois** do dropdown
   Financeiro; a aba "Financeiro" continua dentro de Relatórios.
5. "Financeiro" continua dropdown, agora com 3 itens.
6. `DemurrageMetricsStrip` sai de Taxas Locais. A segunda metade da decisão
   ("levar o saldo em aberto para `/demurrage`") caiu: a premissa era falsa —
   `/demurrage` já tem esse card. Ver Task 7, que passa a carregar uma decisão
   pendente sobre o filtro do card existente.
7. `/faturamento` vira redirect permanente **preservando a query string**.
8. Link da ficha do cliente repontado para a sub-rota + rótulo para "Gerenciar
   em Tabelas"; a rota pai redireciona `?tab=overrides|tabelas` para a filha.
9. Migration nova corrige a rota citada na mensagem de erro do banco.
10. Um único indicador no nav: badge numérico de `chargeReviewRequired`.
11. Renomeiam-se as **páginas** (não services/components).

Todas as decisões acima foram confirmadas pelo autor em 2026-08-18. A decisão 6
foi confirmada já na forma corrigida da Task 7: o strip é removido e a questão
do filtro `overdue` fica pendente do departamento dono, fora deste plano.

**Este plano não foi executado.** A sessão que o produziu foi de planejamento
apenas, por decisão do autor; a implementação acontece em sessão separada.
Quem executar deve seguir as tasks na ordem e tratar o inventário de
referências como a lista de verificação de "nenhuma referência quebrada".

## Global Constraints

- Zero mudança de lógica de negócio: nenhuma RPC, policy, grant, hook de dados,
  chave de cache ou regra de cálculo é tocada.
- Nenhum link pode terminar em tela errada **em silêncio** — é o modo de falha
  desta mudança. Todo destino antigo redireciona ou é atualizado.
- Query string sobrevive a todo redirect. `<Navigate to="/x" replace />`
  descarta `?invoice=`, então o redirect de `/faturamento` usa componente
  próprio que reanexa `location.search`.
- Documentos históricos (`docs/archive/**`) e ADRs existentes **não** são
  reescritos. A decisão nova entra como ADR novo.
- `npm run docs:check` falha se qualquer rota de `App.tsx` não aparecer entre
  crases em `ARCHITECTURE.md` e `RASTREABILIDADE.md` (`check-docs.mjs:133-148`).

## Inventário de referências

Levantamento completo — a base do requisito de "zero quebra".

### Rotas e navegação
- `src/App.tsx:165-168` (rotas), `:97-98` (`routePreloads`)
- `src/components/layout/appLayoutNav.ts:55-67` (itens e badges)
- `src/components/layout/AppLayout.tsx:219-231` (dropdown Financeiro)
- `src/lib/pageTitle.ts:28-31` (regex `^/taxas-locais` casa a sub-rota — ordem
  do array decide; o mais específico vai antes)

### Links internos para `/faturamento` (8 arquivos de produção)
- `src/services/blRails.ts:82,86` — `?invoice=`
- `src/services/customerFicha.ts:65-66` — `?customer=&invoice=`
- `src/lib/customerTableViewModel.ts:2` — `?tab=invoices&customer=&customerName=`
- `src/components/bl/BlFaturamentoTab.tsx:23` — `?invoice=`
- `src/components/clientes/FinanceiroTab.tsx` — 3 links + o botão de tabelas
- `src/pages/Manifestos.tsx:517`, `src/pages/CargaSolta.tsx:447` — `?invoice=`
- `src/pages/Alertas.tsx:216-225` — `?invoice=` e link nu

### Link interno para `/taxas-locais`
- `src/components/clientes/FinanceiroTab.tsx` — `?tab=overrides&cliente=<nome>`,
  botão "Gerenciar em Taxas Locais" (o link de maior risco: passaria a abrir a
  tela de faturamento sem erro visível)

### Banco
- `mark_bl_ready_for_billing`, versão viva em
  `supabase/migrations/275_ready_gate_without_table_validity.sql:134`:
  `'... Configure em /taxas-locais antes de prosseguir.'`
  (mesma função em `129:857` e `268:812`, ambas superadas)

### Testes que fixam rota ou rótulo
- `src/components/layout/__tests__/AppLayout.test.ts:14-17`
- `src/pages/__tests__/TaxasLocais.test.ts:111,124`
- `src/pages/__tests__/Faturamento.test.ts` (`?tab=demurrage`, `?tab=invoices`)
- `src/pages/__tests__/Faturamento.behavior.test.tsx:?invoice=73`
- `src/pages/__tests__/Alertas.behavior.test.tsx:?invoice=123|456`
- `src/components/bl/__tests__/BlBillingHistory.behavior.test.tsx:?invoice=77`
- `src/lib/__tests__/customerTableViewModel.test.ts`, `pageTitle.test.ts`
- `src/services/__tests__/customerFicha.test.ts`

### Documentação viva
`docs/ARCHITECTURE.md:448-454`, `docs/RASTREABILIDADE.md:77-81`,
`docs/README.md:25,30,43-44`, `docs/modules/faturamento.md`,
`docs/modules/taxas-locais.md`, `docs/modules/demurrage.md`,
`docs/modules/clientes.md`, `docs/modules/operacao-suporte.md`,
`docs/operations/validacao.md`, `docs/operations/regras-de-negocio.md`,
`docs/design-audit/README.md`, `skills/design-audit/SKILL.md:64`,
`docs/spec/2026-08-12-behavioral-spec.csv:57,72` (+ `.xlsx` regenerado por
`node scripts/build-behavioral-spec.mjs`), `docs/CHANGELOG.md` (entrada nova).

## Tasks

### Task 1 — Rotas, redirects e títulos
`src/App.tsx`, `src/lib/pageTitle.ts`

- `/taxas-locais` → página de faturamento; `/taxas-locais/tabelas` → página de
  tabelas (rota irmã, como `/demurrage/taxas`).
- `/faturamento` → redirect que **preserva** `location.search`.
- `routePreloads`: **entrada nova e obrigatória** para `/taxas-locais/tabelas`.
  `matchRoutePreload` usa `matchPath` com `end: true` (`src/lib/routePreload.ts`),
  ou seja, casamento **exato** — sem entrada própria, a sub-rota cai no padrão
  `'*'` e pré-carrega o chunk do Painel, o errado. A ordem entre as duas
  entradas não afeta correção (diferente de `pageTitle`, onde afeta).
  `/faturamento` mantém entrada apontando para o chunk certo, para o redirect
  não perder o preload.
- `pageTitle`: `^/taxas-locais/tabelas` → "Tabelas de Taxas Locais", antes de
  `^/taxas-locais` → "Taxas Locais"; `^/faturamento` sai.
- **Check:** teste do redirect com `?invoice=` chegando com a query intacta;
  teste de `routeTitle` para pai e filha.

### Task 2 — Renomear as páginas
`src/pages/Faturamento.tsx` → `src/pages/TaxasLocais.tsx`;
`src/pages/TaxasLocais.tsx` → `src/pages/TaxasLocaisTabelas.tsx`; testes
correspondentes acompanham. Troca cruzada — fazer em commit isolado para o
diff continuar legível. `faturamentoInvoiceStatus.ts`,
`faturamentoLedgerPayment.ts`, `services/billing.ts` e `components/billing/`
**não** mudam de nome, por dois motivos verificados:

- **O banco é a âncora do vocabulário.** `billing.ts` e `billingLedger.ts`
  operam sobre `ready_for_billing`, `billing_hold_reason`, `billing_runs`,
  `last_billing_run_id` e `mark_bl_ready_for_billing`. Renomear o arquivo sem
  poder renomear as colunas e RPCs (migration de verdade, fora do escopo desta
  mudança) troca uma inconsistência por outra pior: arquivo com um nome, corpo
  inteiro com outro.
- **`src/components/taxasLocais/` já existe** (as abas Tabelas e Overrides).
  Renomear `components/billing/` para o nome do processo colidiria com ela.

Registro de precisão: `services/billing.ts` e `billingLedger.ts` **não**
atendem Demurrage (zero referências); quem atende os dois processos é
`services/portalBilling.ts`, do Portal do Cliente. O argumento para preservar
os nomes é a âncora no banco, não uso compartilhado.

### Task 3 — Botão "Tabelas" e redirect por parâmetro
`src/pages/TaxasLocais.tsx` (nova)

- Botão no `PageHeader` levando a `/taxas-locais/tabelas`, no padrão de
  `Demurrage.tsx:328`.
- `?tab=overrides|tabelas` na rota pai redireciona para a filha preservando a
  query, no mesmo padrão do `?tab=demurrage` já existente
  (`Faturamento.tsx:206`).
- **Check:** teste de que `?tab=overrides` não monta a tela de faturamento.

### Task 4 — Navegação
`src/components/layout/appLayoutNav.ts`,
`src/components/layout/AppLayout.tsx`

- `financialNavItems`: Taxas Locais, Demurrage, Conciliação PIX.
- Relatórios vira `TopNavLink` renderizado logo após o dropdown Financeiro.
- `buildFinancialNavItemsForCounts`: badge `chargeReviewRequired` no item Taxas
  Locais; o `alert` booleano sai (mesma fonte, e `getNavIndicator` promovia o
  booleano por cima do número).
- **Check:** atualizar `AppLayout.test.ts`; assertar que Relatórios não está em
  `financialNavItems` e que o indicador é `{type:'badge'}`.

### Task 5 — Links internos
Os 8 arquivos do inventário + rótulo do botão da ficha do cliente para
"Gerenciar em Tabelas". Varredura final: `grep -rn "/faturamento" src/` só pode
sobrar no redirect e nos nomes de módulo `faturamento*`.

### Task 6 — Migration da mensagem
`supabase/migrations/305_<slug>.sql` redefinindo `mark_bl_ready_for_billing`
com `/taxas-locais/tabelas` na mensagem — mesma assinatura, mesmo corpo, só o
texto. Teste de contrato SQL no padrão `*Migration.test.ts`. Migrations
existentes não são tocadas (protegidas por hook e históricas).

### Task 7 — Métrica de Demurrage (commit separado)

**Premissa da decisão 6 corrigida** (review do Codex em #549, verificado no
código): o saldo consolidado em aberto **não** existe só no strip.
`Demurrage.tsx:340` já mostra o card "Aguardando pagamento (BRL)" a partir de
`kpis.issuedInvoicesTotalBrl`. Logo, não há métrica a mover — mover criaria um
segundo card de saldo na mesma página.

Os dois números, porém, **não são o mesmo**:

| Origem | Filtro | Arquivo |
|---|---|---|
| Card de `/demurrage` | `status = 'issued'` | `demurrageKpis.ts:120` |
| Strip de Taxas Locais | `status = 'issued' OR 'overdue'` | `DemurrageMetricsStrip.tsx:23` |

Ou seja, uma fatura de demurrage **vencida** sai do total "Aguardando
pagamento" da página de Demurrage, embora continue aguardando pagamento.

A task passa a ser:

1. Remover `<DemurrageMetricsStrip />` da tela de Taxas Locais e apagar o
   componente (sem outro chamador). Nada é acrescentado a `/demurrage`.
2. **Decisão pendente do dono do processo (Equipamentos):** `overdue` deve
   entrar em "Aguardando pagamento (BRL)"? Se sim, é uma linha em
   `fetchDemurrageKPIs` (`.eq('status','issued')` → `.in('status',
   ['issued','overdue'])`) mais o teste correspondente — **mas é mudança de
   número exibido**, não reorganização de tela, então vai em commit próprio e
   só com aprovação explícita. Se não, o strip morre sem substituto.

As outras métricas do strip (contagem de faturas, contagem em aberto, total
USD de todas) não têm equivalente em `/demurrage`, que mostra "Total USD
(visível)" (recorte da grade filtrada) e "Containers em atraso". Nenhuma delas
foi apontada como necessária; morrem com o strip.

### Task 8 — Documentação e ADR
ADR novo: "Módulo financeiro segregado por processo faturável", registrando os
dois processos, os departamentos donos e por que a tela de invoices chama-se
Taxas Locais. Realinhar toda a documentação viva do inventário; `docs/archive/**`
e ADRs anteriores ficam intactos. Regenerar o XLSX da spec comportamental.

**Os arquivos `docs/modules/*.md` mantêm os nomes atuais.** `check-docs.mjs:92-105`
tem a lista de módulos hardcoded e valida a estrutura de seções de cada um;
renomear `faturamento.md`/`taxas-locais.md` obrigaria a editar o próprio
validador. Muda o conteúdo e o escopo declarado de cada documento, não o
caminho — e `faturamento.md` segue existindo porque emissão, ledger e pagamento
continuam sendo um assunto próprio, agora explicitamente compartilhado pelos
dois processos faturáveis.

### Task 9 — Verificação
`npm run docs:check`, `npm run lint`, `npm test`, `npm run build`. Varredura
final de `\/faturamento` e `\/taxas-locais` em `src/`, `docs/` (fora de
archive), `scripts/` e `skills/`.
