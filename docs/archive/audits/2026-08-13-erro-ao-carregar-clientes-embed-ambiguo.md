# Investigação — "Erro ao carregar clientes" e lentidão percebida nas telas

> **Snapshot histórico:** este relatório descreve o repositório e o projeto
> Supabase na data indicada. Achados podem ter sido corrigidos depois. Para o
> estado atual, consulte [`docs/README.md`](../../README.md), o código e as
> migrations.

**Data:** 2026-08-13 · **Origem:** relato do responsável — a tela `/clientes`
exibe "Erro ao carregar clientes", as páginas demoram a carregar e clicar em
"Clientes" no menu não abre a tela (só funciona com F5) ·
**Escopo:** diagnóstico e correção · **Projeto:** `fgmkhbzhaeebrsizwccx`
(Transhipping Desk, `sa-east-1`).

Rótulos de evidência conforme [`docs/CONVENCOES.md`](../../CONVENCOES.md):
**Código**, **Teste**, **Runtime**.

## Resumo

A causa é **uma só**: a migration `285_manifest_import_customer_suggestion.sql`
criou a foreign key `bls_suggested_customer_id_fkey`, dando a `bls` **dois**
caminhos para `customers` (`customer_id` e `suggested_customer_id`). O PostgREST
recusa embeds ambíguos com `300 Multiple Choices` / `PGRST201` — e a request
**inteira** falha, não apenas o embed. Toda tela que embedava `customers` com
`bls` sem nomear a FK quebrou.

A lentidão percebida é consequência do mesmo erro: o TanStack Query repetia a
query falha 3 vezes com backoff exponencial (≈1s + 2s + 4s), então a tela ficava
~7 segundos em estado de carregamento antes de mostrar o erro — o que, ao clicar
no menu, se parece com "a página não abriu".

| # | Achado | Impacto | Evidência |
|---|---|---|---|
| A | Embed ambíguo `customers`↔`bls` devolve `300 PGRST201` — quebra `/clientes` e a listagem de Demurrage | crítico | Runtime + Código |
| B | Retry padrão do TanStack Query repete erro determinístico 3× com backoff (~7s de spinner) | alto | Código |
| C | KPIs de `/clientes` refazem a varredura completa da base a cada troca de página ou clique de ordenação | médio | Código |

## A — Embed ambíguo entre `customers` e `bls`

**Evidência: Runtime.** Os `edge_logs` do projeto registram a request da tela de
Clientes com status `300`:

```
GET | 300 | /rest/v1/customers?select=*,bls(id,charge_status),customer_contacts(...)&order=name.asc&or=(name.ilike.%qa%,...)
```

O corpo da resposta:

```json
{"code":"PGRST201",
 "message":"Could not embed because more than one relationship was found for 'customers' and 'bls'",
 "hint":"Try changing 'bls' to one of the following: 'bls!bls_customer_id_fkey', 'bls!bls_suggested_customer_id_fkey'"}
```

O catálogo confirma os dois caminhos:

| Constraint | Coluna |
|---|---|
| `bls_customer_id_fkey` | `bls.customer_id` (cliente efetivo) |
| `bls_suggested_customer_id_fkey` | `bls.suggested_customer_id` (sugestão do importador, migration `285`) |

`granite_bls` tem o mesmo par duplo desde antes (`granite_bls_client_id_fkey` /
`granite_bls_suggested_client_id_fkey`) e por isso **já** nomeava a FK em todos
os selects — o padrão existia, só não foi aplicado quando `bls` ganhou a
segunda FK.

**Call sites quebrados** (Evidência: Código):

| Arquivo | Tela afetada |
|---|---|
| `src/hooks/useCustomers.ts` (`fetchCustomerRows`) | listagem `/clientes` |
| `src/hooks/useCustomers.ts` (`useCustomerDetail`) | ficha `/clientes/:cnpj` |
| `src/pages/Clientes.tsx` (`handleExportBase`) | exportação da base |
| `src/services/demurrage/demurrageContainers.ts` | listagem de containers em Demurrage |

**Correção.** As formas corretas foram validadas contra a API real antes de
entrar no código (Evidência: Runtime — todas `HTTP 200`):

```
customers?select=*,bls!bls_customer_id_fkey(id,consignee)             → 200
customers?select=id,bls!bls_customer_id_fkey!inner(id,charge_status)  → 200
bl_containers?select=id,bl:bls(id,customer:customers!bls_customer_id_fkey(id,name)) → 200
```

Os aliases passaram a viver em `src/lib/supabaseEmbeds.ts`
(`BLS_OF_CUSTOMER`, `BLS_OF_CUSTOMER_INNER`, `CUSTOMER_OF_BL`), com o motivo
documentado no módulo. Evidência: **Teste** —
`src/hooks/__tests__/useCustomersEmbeds.test.ts` afirma que o select gerado
nomeia a FK e que nenhuma forma crua `bls(` sobra.

## B — Retry de erro determinístico

**Evidência: Código.** `src/lib/queryClient.ts` não sobrescrevia `retry`, então
valia o padrão do TanStack Query: 3 tentativas com backoff exponencial. Um
`PGRST201` (ou um `42501` de RLS) é determinístico — a segunda e a terceira
tentativa devolvem exatamente o mesmo erro, só somando latência antes da tela
mostrar a mensagem.

`isRetriableDbError` (`src/lib/errors.ts`) passou a barrar retry de erros
determinísticos: `PGRST1xx`/`PGRST2xx` (construção de query e schema cache) e as
classes `permissao`, `sessao_expirada`, `validacao`, `nao_encontrado` e
`limite`. Falhas transitórias (rede, `40001`) continuam repetindo.
Evidência: **Teste** — `src/lib/__tests__/errors.test.ts`.

## C — KPIs de `/clientes` revarrendo a base

**Evidência: Código.** `useCustomerSummary` usava `['customers-summary', filters]`
como query key, com `filters` incluindo `page`, `pageSize`, `sortKey` e
`sortDirection`. Nenhum dos quatro muda o resultado — os KPIs somam todos os
clientes que passam pelos filtros. Cada troca de página ou clique num cabeçalho
de coluna invalidava a chave e disparava outra varredura completa de `customers`
(em lotes de 1000) mais a varredura de faturas emitidas.

`customerSummaryFilters` normaliza o escopo antes de montar a chave.
Evidência: **Teste** — `src/hooks/__tests__/useCustomersEmbeds.test.ts`.

## O que foi descartado

**Volume de dados.** Segue irrelevante (Evidência: Runtime,
`pg_stat_user_tables`): `bl_containers` 1.112, `bls` 135, `customer_contacts` 42,
`customers` 40, `invoices` 5 linhas.

**Tempo de banco.** Os `edge_logs` mostram `response.origin_time` médio de 60 a
180 ms por endpoint; `/rest/v1/customers` tem média de 166 ms. Nenhuma query do
sistema interno aparece como lenta.

**RLS e RPCs.** O advisor de performance só reporta `auth_rls_initplan` em cinco
tabelas `portal_*`, fora do caminho das telas relatadas, e um
`multiple_permissive_policies` em `vazios_export_service_lines`. As 75 foreign
keys sem índice de cobertura seguem em nível `INFO` e irrelevantes neste volume.
Nenhuma policy nega leitura de `customers` para o perfil relatado — a request
falhava antes de chegar na RLS, no planejamento do embed.

**Realtime.** A auditoria de 2026-08-12 apontou o polling do WAL como 45% do
tempo de execução do banco. O número se confirma
(`pg_stat_statements`: 33,5% + 11,6%), **mas é percentual de um total pequeno**:
a soma de todo o tempo de execução do banco é de ~2,2 horas em 128 dias de
janela. O banco está essencialmente ocioso e não é o gargalo. As assinaturas
client-side já haviam sido removidas (ver os `ponytail:` em
`src/hooks/useOperationalCounts.ts` e `src/hooks/usePortalBilling.ts`); a
publication `supabase_realtime` está vazia.

**Carregamento frio / login.** Fora do escopo desta investigação: já coberto pelo
plano vivo
[`2026-08-13-correcao-regressao-inicializacao-login-navegacao.md`](../../plans/2026-08-13-correcao-regressao-inicializacao-login-navegacao.md)
e pela auditoria
[`2026-08-12-investigacao-lentidao-carregamento-paginas.md`](2026-08-12-investigacao-lentidao-carregamento-paginas.md).

## Lição

Adicionar uma segunda foreign key entre duas tabelas é uma mudança de schema que
**quebra selects existentes** do PostgREST em silêncio — o erro só aparece em
runtime, no cliente, como `300`. A checklist de migration deve incluir: ao criar
uma FK, verificar se o par de tabelas já tinha outra e, em caso positivo, nomear
a FK em todos os embeds existentes.
