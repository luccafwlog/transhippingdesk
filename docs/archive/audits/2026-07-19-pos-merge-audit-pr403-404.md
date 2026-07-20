# Auditoria pós-merge — PRs #403 e #404

Data da auditoria: 2026-07-19  
Autoridade corrente: `origin/main` em `9da9bb7609de1db7d5dadf73963fa742d5d0b06f`  
Escopo: revisão somente leitura do histórico e do estado atual; nenhum arquivo versionado do repositório auditado foi alterado.

## Resumo executivo

- **Bloqueadores (P0/P1): 0.** Não encontrei regressão de autorização, corrupção de dados, mudança de schema/rota ou falha funcional que exija rollback dos merges.
- **P2: 1.** O lookup curto de clientes ainda transforma um termo que fica vazio após o escape em `ilike.%%`; é um call-site residual da mesma invariante tratada pelo PR #404.
- **P3: 3.** Falta teste de regressão para o escape do export da página de Clientes; a atualização obrigatória do runbook de segurança não foi feita e o plano foi arquivado fora do merge; o PR #403 introduziu uma pequena mudança visual de formatação apesar do contrato “behavior-preserving”.
- Os gates correntes estão verdes. A suíte completa em `origin/main` passou com **283 arquivos / 1.134 testes**, além de 1 arquivo e 9 testes pulados; lint, docs, build/typecheck e size-limit também passaram.
- O núcleo das duas entregas está correto: as extrações do PR #403 preservam o fluxo e as assinaturas públicas; o PR #404 neutraliza os call-sites principais de filtro PostgREST e centraliza corretamente a proteção de fórmula para XLSX/CSV.

> Correção de identificação: o hash curto informado para o PR #403, `75dcd81`, não existe no histórico autoritativo. O merge correto é **`75cdd81`** (`75cdd8197bee989ce97e7300cd0698961d375c1a`).

## Método e fontes

Foram usados como fontes, nesta ordem:

1. árvore e histórico Git de `origin/main`;
2. código executável e testes no snapshot corrente;
3. metadados, corpo, comentários e revisões dos PRs no GitHub;
4. `CLAUDE.md`, `CONTEXT.md`, `docs/ARCHITECTURE.md`, `WORKFLOW.md` e `docs/CONVENCOES.md`;
5. planos/auditorias datados apenas como contexto histórico.

Comparei cada merge contra o primeiro pai, li os commits de correção de review, procurei interseções com commits posteriores, inspecionei todos os call-sites correntes de `.or()` e de geração XLSX/CSV, e executei testes/builds em snapshots materializados fora do worktree.

## Topologia e dimensão dos merges

| PR | Merge | Pais | Diff contra primeiro pai |
|---|---|---|---|
| [#403 — code quality remediation](https://github.com/luccafwlog/transhippingdesk/pull/403) | `75cdd8197bee989ce97e7300cd0698961d375c1a` | `f3fdd64bb6e90f54b1e39958d3f127b043f0275e` + `9ccf3a2f2159d7c1517af715cf8bd8116b21e8fa` | 51 arquivos, +4.015 / -2.679 |
| [#404 — injection remediation](https://github.com/luccafwlog/transhippingdesk/pull/404) | `44c1322e7a18be85ddae4dac26cfb238f034fcb9` | `75cdd8197bee989ce97e7300cd0698961d375c1a` + `29c8b49f52ba6b233da35a697ac0cdb6a3d992bd` | 16 arquivos, +241 / -88 |

O segundo pai do PR #404 inclui o merge de `main` (`29c8b49`) feito para resolver a sobreposição com o PR #403. A resolução preservou a decomposição recém-mergeada de `Clientes.tsx` e `billing.ts` e reaplicou as correções de segurança; não encontrei perda de código de nenhum dos lados.

## PR #403 — `refactor: remediate code quality audit findings`

### Contexto de review

O PR se propôs a consolidar formatadores e `PreviewBox`, extrair subetapas de dois serviços grandes e decompor as páginas/abas monolíticas de Clientes, Demurrage, Taxas Locais e Validação de Faturamento, sem schema, rota ou mudança de contrato.

O review pediu: eliminar o `fmtBRL` restante em `CustomerSummaryReport`, verificar a diferença de NBSP do `Intl`, cobrir `decimals={0}`, retirar um cast duplo de fixture e deixar o PR pronto para review. O commit `9ccf3a2` endereçou esses pontos; não restou thread de review aberta.

### Verificação por slice

| Slice | Áreas | Estado e avaliação |
|---|---|---|
| 1 — formatadores | `demurragePresentation.ts`, `CustomerSummaryReport.tsx`, `src/lib/utils.ts` | **Implementado.** `fmtBRL` delega a `formatBRL`, a divergência de espaço do `Intl` está registrada com `ponytail:`, e há apenas uma definição de `formatCountLabel`, em `src/lib/utils.ts`. O helper de impressão de `CustomerSummaryReport` passou a reutilizar `invoiceFormat`. |
| 2 — `PreviewBox` | primitiva canônica + 6 consumidores | **Implementado.** Existe uma única definição, em `src/components/ui/PreviewBox.tsx`. As variantes visuais específicas (`metric-centered`, `metric-strip`, `surface`, `kpi` e tones) foram preservadas após o ajuste `6a90a23`. Testes cobrem número, string, decimais, zero decimais e variantes. Há um pequeno desvio do contrato “sem comportamento”; ver P3-3. |
| 3 — serviços grandes | `src/services/billing.ts`, `src/services/voyageSummaries.ts` | **Implementado.** `listInvoiceDetails` foi dividido em helpers de mapeamento/hidratação de Granite, consolidada, breakdown e PIX; `buildVoyageTimeline` foi dividido por família de evento. Assinaturas públicas e ordem final permaneceram. O bug intermediário de cobertura CE `NaN` foi corrigido em `e33b33a` e ganhou teste. |
| 4 — páginas | `Clientes.tsx`, `Demurrage.tsx` + componentes de domínio | **Implementado.** `Clientes.tsx` caiu de 996 para 517 linhas no merge (520 no estado corrente, por import do PR #404) e `Demurrage.tsx` de 978 para 446. Estado, queries e mutations continuam nos containers; tabela, formulários, abas e modais foram extraídos. Behavior tests cobrem criar/importar/excluir/ordenar clientes e fluxos principais de demurrage. |
| 5 — abas | `ChargeTablesTab.tsx`, `ValidacaoTab.tsx` | **Implementado.** Os arquivos caíram, respectivamente, de 712 para 270 e de 788 para 364 linhas. Queries/mutations e invalidations permanecem no dono; renderização/formulários/tabela foram extraídos. O callback de emissão individual de Validação tem teste dedicado. |
| Docs/gates | docs de módulos, rastreabilidade, changelog e plano | **Implementado conforme a convenção.** Docs vivos foram atualizados no mesmo merge; o plano foi marcado e arquivado no mesmo change. |

### Correção, arquitetura, segurança e desempenho

- A direção de dependências continua `pages -> hooks/services`, e os componentes extraídos não passaram a acessar persistência por conta própria.
- Não houve migration, alteração de RLS, nova RPC, mudança de rota ou novo segredo.
- A extração de UI não duplicou queries; o dono de estado continua no container e os filhos recebem dados/callbacks.
- `billing.ts` e `voyageSummaries.ts` cresceram em linhas totais (946 -> 993 e 851 -> 923), mas as funções-alvo ficaram segmentadas e nomeadas. O objetivo era reduzir complexidade por função, não necessariamente o tamanho físico desses serviços.
- Build comparativo `f3fdd64` -> `75cdd81`: o bundle medido pelo size-limit foi de 159,21 kB para 159,27 kB brotli (+0,06 kB). Os chunks das rotas afetadas cresceram entre ~0,2 e ~0,5 kB gzip, sem aproximação do orçamento de 250 kB. Não há regressão material de performance de bundle.

## PR #404 — `fix(security): remediate injection audit findings`

### Contexto de review

O PR tratou interpolação de input em filtros `.or()` do PostgREST e injeção de fórmula em planilhas. O primeiro review encontrou dois pontos adicionais: `Clientes.handleExportBase` ainda interpolava a busca sem escape, e os novos call-sites construíam filtro match-all quando o termo escapado ficava vazio. O commit `c78573e` adicionou os guards e o escape da página; o reviewer confirmou a correção. O merge de `main` em `29c8b49` resolveu a concorrência com o PR #403. Não restou thread aberta.

### Verificação por task

| Task | Área | Estado e avaliação |
|---|---|---|
| 1 | `listGraniteBls` | **Implementado.** Usa `escapeFilterTerm`, só aplica `.or()` quando há termo seguro e tem regressão para vírgula e termo vazio. |
| 2 | `listVaziosBookings` | **Implementado.** Mesmo padrão e cobertura. |
| 3 | `fetchCustomerRows` | **Implementado.** Nome/fantasia/documento usam termo escapado; o caminho de documento usa somente dígitos; cláusulas vazias não são enviadas. Teste cobre payload estrutural e vazio. |
| 4 | `listBillingCustomers` | **Implementado.** O guard ad-hoc foi substituído por `escapeFilterTerm`; o termo de dígitos permanece isolado e só se envia `.or()` com cláusula válida. |
| 5 | `src/lib/spreadsheetSafe.ts` | **Implementado.** `sanitizeCellValue` e `sanitizeSheetRows` são a fonte canônica, com testes para `=`, `+`, `-`, `@`, tipos normais e linhas completas. |
| 6 | export do Line Up | **Implementado.** Saiu de `Painel.tsx`, usa `toSheet` sanitizado em `src/services/exports.ts` e tem teste de fórmula. Dados/status e conteúdo das colunas foram preservados; o nome do arquivo ganhou timestamp completo em vez de somente a data. |
| 7 | deduplicação XLSX/CSV | **Implementado.** `exports.ts` e `reconciliacao.ts` usam `sanitizeSheetRows`; `csv.ts` usa `sanitizeCellValue`. A geração direta restante em `ChegadasSaidas.tsx` produz apenas um template constante, não dados não confiáveis. |
| 8 | documentação e verificação | **Parcial.** Os gates foram executados e estão verdes, mas a alteração prescrita em `docs/operations/seguranca.md` não foi feita. Ver P3-2. |
| Extra de review | `Clientes.handleExportBase` | **Código corrigido, cobertura ausente.** O termo é escapado e guardado; não há teste do caminho da página. Ver P3-1. |

### Correção, fronteira de segurança e desempenho

- A correção não amplia autorização: todos os pontos continuam internos, autenticados e sujeitos a RLS. Não houve migration ou alteração de policy.
- Nos call-sites corrigidos, metacaracteres estruturais, `%` e `_` deixam de controlar o parser/padrão; os guards impedem `ilike.%%` nos fluxos principais.
- Todas as exportações de dados XLSX em `exports.ts`, o XLSX de reconciliação e o CSV passam pelo helper compartilhado. O Line Up usa import dinâmico de `@e965/xlsx`, preservando o lazy loading da biblioteca grande.
- Build comparativo `75cdd81` -> `44c1322`: size-limit de 159,27 kB para 159,31 kB brotli (+0,04 kB). O chunk `Painel` caiu de 16,59/4,72 kB para 15,91/4,45 kB raw/gzip; o chunk auxiliar de exports subiu ~0,69/0,20 kB. Não há regressão material de bundle.

## Achados acionáveis

### P2-1 — `useCustomerLookup` ainda emite `ilike.%%` quando o termo seguro fica vazio

**Local atual:** `src/hooks/useCustomers.ts:214-225`.

O hook habilita a query por `search.trim().length >= 2` antes de sanitizar. Dentro da query, `escapeFilterTerm(search)` pode resultar em string vazia — por exemplo, `%%`, `__` ou `,,` — mas o código ainda monta:

```ts
.or(`name.ilike.%${term}%,cnpj_cpf.ilike.%${term}%`)
```

Isso produz `name.ilike.%%,cnpj_cpf.ilike.%%`. O `range(0, 24)` limita a transferência, e RLS limita a visibilidade, portanto não é bypass de autorização; porém o predicado wildcard continua podendo forçar varredura e retorna opções arbitrárias. É exatamente a classe de risco de enumeração/custo que o PR #404 e o comentário de `escapeFilterTerm` dizem evitar.

O call-site já existia antes do PR, mas o PR alterou o mesmo módulo, declarou restaurar a invariante dos filtros de cliente e adicionou guards de termo vazio aos demais call-sites. A busca curta ficou fora do inventário e segue igual em `origin/main`.

**Correção proposta:** calcular o termo seguro antes de criar `useQuery`, habilitar apenas quando o termo sanitizado tiver comprimento mínimo (ou houver caminho de documento seguro) e retornar `[]` sem tocar no Supabase quando não houver cláusula válida. Adicionar regressão para `%%` e para um payload estrutural como `ACME,ME`.

### P3-1 — o escape de `Clientes.handleExportBase` não tem teste de regressão

**Locais atuais:** `src/pages/Clientes.tsx:263-289` e `src/pages/__tests__/Clientes.behavior.test.tsx:59-60`.

O ponto foi encontrado durante o review do PR #404 e corrigido em `c78573e`, mas nenhum teste exercita o botão de export com busca. O behavior test atual mocka `exportCustomerBaseWorkbook` e define `supabase` como `{}`, o que comprova que esse caminho nunca é chamado na suíte. Os testes novos de injeção cobrem `fetchCustomerRows`, Granite, Vazios e billing, não a query direta da página.

**Correção proposta:** tornar o mock de Supabase encadeável, preencher a busca com `ACME,ME`, clicar em “Exportar” e afirmar `.or('name.ilike.%ACME ME%,trade_name.ilike.%ACME ME%,cnpj_cpf.ilike.%ACME ME%')`; cobrir também termo que fica vazio e confirmar que não se envia `ilike.%%`.

### P3-2 — Task 8 do plano de segurança não foi executada e o runbook vivo aponta para o dono errado

**Locais atuais:** `docs/operations/seguranca.md:55-60` e `docs/archive/plans/2026-07-18-security-audit-injection-remediation.md:736-767`.

O plano mandava atualizar os dois bullets de segurança para registrar os quatro call-sites e o guard único em `src/lib/spreadsheetSafe.ts`. O PR #404 não alterou documentação. A doc viva ainda afirma que exports passam pelo sanitizador de `src/services/exports.ts`, mas o dono canônico atual é `src/lib/spreadsheetSafe.ts`, consumido também diretamente por `src/lib/csv.ts` e `src/services/reconciliacao.ts`.

Além disso, o plano ficou em `docs/plans/` após o merge e só foi arquivado em `9da9bb7`, depois dos PRs #405 e #406. Isso contraria `CLAUDE.md:113-116` e `docs/CONVENCOES.md:58`, que exigem arquivar no mesmo change que conclui o trabalho. Todas as checkboxes continuam `[ ]`, embora o commit posterior diga “já implementado” e a própria Task 8 permaneça ausente.

**Correção proposta:** corrigir apenas a documentação viva (`docs/operations/seguranca.md`) com o owner real e os fluxos cobertos. Não reescrever o plano histórico arquivado; se for necessário explicar a divergência, criar nota editorial/relatório novo, conforme a convenção de imutabilidade do archive.

### P3-3 — o PR #403 não foi estritamente “behavior-preserving” na apresentação numérica

**Locais atuais:** `docs/archive/plans/2026-07-18-code-quality-audit-remediation.md:12-16`, `src/components/ui/PreviewBox.tsx:11-17` e `src/components/ui/PreviewBox.test.tsx:9-23`.

O plano e o PR afirmam que não haveria mudança de comportamento. O componente canônico, entretanto, passou a aplicar `toLocaleString('pt-BR')` a todo valor numérico, e o teste fixa explicitamente `1234 -> 1.234`. Antes da migração, os `PreviewBox` locais de `BlImportModal`, `CeMercanteImportModal`, `ContainerDatesImportModal` e `Veiculos` renderizavam o número bruto (`1234`). Também há a diferença de espaço do `Intl` no BRL, mas essa foi conscientemente registrada com `ponytail:`.

Não há perda de precisão nos call-sites atuais nem evidência de impacto operacional; a localização é provavelmente desejável. O problema é de aderência ao contrato histórico, não de cálculo.

**Correção proposta:** se a localização for intencional, registrar a pequena mudança visual em documentação viva ou nota editorial, sem editar o plano arquivado. Se a exigência for equivalência visual estrita, adicionar opção explícita de formatação ou passar string nos quatro consumidores antigos.

## Riscos avaliados e não confirmados como defeito

- Os guards de termo escapado vazio nos call-sites corrigidos tratam um termo composto só de metacaracteres como busca vazia. Isso pode mostrar/exportar o conjunto não filtrado, mas essa operação já é permitida ao mesmo usuário ao limpar a busca e continua sob RLS. O ganho relevante é não enviar um predicado `ilike.%%` caro. Não classifiquei isso como vulnerabilidade.
- O regex de fórmula mantém a mesma política canônica que já existia (`=`, `+`, `-`, `@`, tab e CR) e agora está centralizado. Não encontrei export de dados não confiáveis que contorne o helper.
- O uso de helpers mutáveis em `listInvoiceDetails` não cria estado compartilhado: cada detalhe é instanciado por chamada e os hydrators são aguardados sequencialmente como no fluxo original.
- Nenhum commit posterior a `44c1322` altera os arquivos executáveis tocados por #403/#404. PRs #405/#406 só cruzam docs vivos compartilhados; `9da9bb7` move o plano de segurança e remove sua linha do índice ativo.

## Evidência de verificação

| Snapshot | Comando | Resultado |
|---|---|---|
| `75cdd81` (PR #403) | `npm test` | 268 arquivos passados + 1 pulado; 1.110 testes passados + 9 pulados |
| `75cdd81` | `npm run build` | typecheck + Vite build, exit 0 |
| `75cdd81` | `npm run size-limit` | 159,27 kB brotli de 250 kB |
| `44c1322` (PR #404) | `npm test` | 274 arquivos passados + 1 pulado; 1.122 testes passados + 9 pulados |
| `44c1322` | `npm run build` | typecheck + Vite build, exit 0 |
| `44c1322` | `npm run size-limit` | 159,31 kB brotli de 250 kB |
| `origin/main` (`9da9bb7`) | `npm test` | 283 arquivos passados + 1 pulado; 1.134 testes passados + 9 pulados |
| `origin/main` | `npm run lint` | exit 0, sem erros |
| `origin/main` | `npm run docs:check` | 159 Markdown, 39 rotas e índice ADR verificados |
| `origin/main` | `npm run build` | typecheck + Vite build, exit 0 |
| `origin/main` | `npm run size-limit` | 159,34 kB brotli de 250 kB |
| `origin/main` | 17 testes focados de #403/#404 | 17 arquivos / 52 testes passados |
| ambos os merges | `git diff --check` | exit 0 |

## Conclusão

Os dois merges são aproveitáveis e permanecem estáveis no estado corrente. O PR #403 atingiu a decomposição e a consolidação pretendidas com risco funcional baixo; o PR #404 fechou os vetores principais e criou uma fronteira compartilhada adequada para planilhas. Recomendo uma correção curta para `useCustomerLookup` antes de declarar a invariante PostgREST completamente encerrada, seguida pelos testes/documentação listados. Nenhum achado exige rollback ou bloqueia o trabalho atual de Agency Departure Report.
