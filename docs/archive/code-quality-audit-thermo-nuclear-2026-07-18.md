# Auditoria de Qualidade de Código — Thermo-Nuclear — 2026-07-18

Revisão estrutural profunda do projeto inteiro (skill
`thermo-nuclear-code-quality-review`), executada sobre
`claude/thermo-nuclear-code-quality-p1xq77` em `21750a4`. Registro histórico:
reflete o estado do código na data acima. Foco exclusivo em **estrutura,
abstrações, duplicação, fronteiras de camadas e teto de manutenibilidade** — não
em bugs funcionais.

> Nota editorial (2026-07-18): esta é a segunda auditoria thermo-nuclear. A
> primeira ([`code-quality-audit-2026-07-06`](code-quality-audit-2026-07-06.md))
> gerou o plano vivo
> [`2026-07-06-code-quality-audit-remediation`](plans/2026-07-06-code-quality-audit-remediation.md),
> cujos checkboxes nunca foram marcados **mas cuja maior parte foi de fato
> executada** (ver "Progresso desde 2026-07-06"). As medidas previstas por esta
> auditoria foram consolidadas no plano vivo
> [2026-07-18-code-quality-audit-remediation](../plans/2026-07-18-code-quality-audit-remediation.md).
> Este arquivo permanece como registro histórico e não deve ser alterado.

Escala em `src/`: ~48,7 mil linhas de TypeScript/TSX (excluindo testes e o
`src/types/database.ts` gerado). Migrations SQL e o tipo gerado ficam **fora do
escopo de decomposição** — são registros imutáveis, não código que um PR faz
crescer.

## Sumário executivo

A higiene de base continua acima da média: **zero `as any`**, **zero
`TODO`/`FIXME`** reais, apenas **7 arquivos** com `eslint-disable`, serviços bem
separados por domínio e documentação viva de qualidade incomum. A auditoria de
2026-07-06 moveu a agulha de verdade (detalhes abaixo). Os achados que restam são
todos **estruturais** e concentrados em duas categorias:

1. **Consolidação canônica incompleta** — abstrações canônicas foram criadas,
   mas o *rollout* parou no meio: 6 cópias locais de `PreviewBox` ignoram o
   componente canônico, e a formatação de moeda existe em três lugares com
   arredondamento divergente.
2. **Componentes-página monolíticos** — `Clientes.tsx` (996) e `Demurrage.tsx`
   (978) continuam como uma única função gigante cada, com 13 e 23 `useState`
   respectivamente. O próprio repositório já provou que sabe decompor
   (`Manifestos.tsx` caiu de 1089 → 514; `Baplie.tsx` é o modelo).

Nenhum achado exige reescrita. Cada um tem um movimento que **apaga**
complexidade — reusar o dono canônico que já existe, ou extrair subcomponentes
que o repositório já sabe escrever — em vez de rearranjá-la.

## Progresso desde 2026-07-06 (verificado no código)

| Achado anterior | Estado atual |
| --- | --- |
| Inversão de camada: `src/pages/viagensHelpers.ts` (917) importado por `lib/` e `components/` | **Resolvido.** O arquivo não existe mais em `src/pages/`; nenhum import invertido em `lib/`/`components/`. |
| `toNumber` corrompia decimais em formato US | **Resolvido.** `src/lib/utils.ts` agora usa detecção do último separador (vírgula vs. ponto) antes de normalizar. |
| Abstração de página-de-lista copiada em ~11 páginas | **Landed.** `usePageFilters` (`src/hooks/usePageFilters.ts`) e `TableFooterPagination` (`src/components/ui/TableFooterPagination.tsx`) existem e já são usados em 6+ páginas. |
| Duplicatas `chunkArray`, `normalizeHeader`, `normalizePortCode` | **Consolidadas** em `src/lib/utils.ts` e `src/services/portCode.ts`; chamadores migrados. |
| `Manifestos.tsx` (1089) monolítico | **Decomposto** para 514 linhas. |

O padrão é claro: a equipe sabe executar esses movimentos. Os itens abaixo são o
que ficou para trás ou cresceu depois.

## P1 — Consolidação canônica incompleta e monólitos vivos

### 1.1 `PreviewBox`: canônico existe, mas 6 cópias locais o ignoram

`src/components/ui/PreviewBox.tsx` é o dono canônico
(`{ label, value: number, variant }`). Mesmo assim persistem **seis**
reimplementações locais idênticas ou quase idênticas:

- Drop-in (assinatura `{ label, value: number }`, substituíveis já):
  - `src/components/shared/ContainerDatesImportModal.tsx:145`
  - `src/components/shared/CeMercanteImportModal.tsx:330`
  - `src/components/shared/BlImportModal.tsx:304`
  - `src/pages/CargaSolta.tsx:585`
- Exigem uma extensão mínima do canônico:
  - `src/pages/Granite.tsx:467` — adiciona `decimals`.
  - `src/pages/Veiculos.tsx:521` — aceita `value: number | string`.

**Remédio (code-judo, apaga código).** Estender o canônico para
`value: number | string` e uma prop opcional `decimals`, então deletar as seis
cópias e importar de `../ui/PreviewBox`. É subtração líquida de código, exatamente
o que a Slice 4 do plano anterior previu e não fechou.

### 1.2 Formatação de moeda triplicada com arredondamento divergente

Existe formatador canônico em `src/lib/utils.ts` (`formatBRL`/`formatUSD` via
`Intl.NumberFormat`), usado por dezenas de componentes de billing/BL. Ainda
assim:

- `src/services/demurrage/demurragePresentation.ts` — `fmtUSD` **delega** ao
  canônico `formatUSD` (correto), mas `fmtBRL`, logo abaixo, **reescreve à mão**
  `'R$ ' + value.toLocaleString(...)`. Inconsistência dentro do mesmo arquivo:
  um irmão delega, o outro duplica.
- `src/components/shared/invoiceFormat.ts` — terceiro `fmtBRL`, também à mão.

O `Intl.NumberFormat` do canônico emite espaço **não-quebrável** (`R$ `),
enquanto as variantes à mão usam espaço comum. Para os documentos imprimíveis
(`invoiceFormat.ts`) essa diferença pode ser **intencional** — trato como
ressalva, não como bug. Já em `demurragePresentation.ts` (UI de app, não
impressão) não há justificativa: `fmtBRL` deveria delegar ao canônico como o
irmão `fmtUSD` já faz.

**Remédio.** `demurragePresentation.fmtBRL(value) => value == null ? '---' :
formatBRL(value)`. Se a formatação de impressão precisar mesmo de espaço comum,
documentar isso em `invoiceFormat.ts` com um `ponytail:` explicando o porquê, em
vez de deixar a divergência parecer *drift*.

### 1.3 `Clientes.tsx` (996) — componente monolítico de ~890 linhas

Uma única função `Clientes()` (`src/pages/Clientes.tsx:90`→`980`) com 13
`useState` e ~15 handlers internos, cujo `return` (`:411`) contém inline: a
tabela principal (`:536`), o modal de criação com formulário de contatos
(`:748`), e o modal de importação com sua própria tabela de preview (`:858`,
`:922`).

**Remédio.** Extrair `CustomerTable`, `CreateCustomerModal` (dono do
`ContactForm`) e `ImportBaseModal`. O `Clientes()` restante vira composição +
estado de tela. É o mesmo movimento que já reduziu `Manifestos.tsx` de 1089 →
514; `Baplie.tsx` é o modelo de referência (container de ~230 linhas + 7
subcomponentes focados).

### 1.4 `Demurrage.tsx` (978) — 23 `useState` + 18 queries/mutations numa função

`Demurrage()` (`src/pages/Demurrage.tsx:58`) mistura, num só corpo, o estado de
seis fluxos distintos: edição de datas de container, visualização de fatura,
desconto, disputa, PTAX manual e relatório por cliente — cada um com seu par
`useState`/mutation e seu modal renderizado inline. As abas
(`containers`/status de fatura/`clientes`) são fronteiras naturais de
componente.

**Remédio.** Extrair um componente por aba e um modal por fluxo
(`DiscountModal`, `DisputeModal`, `PtaxModal`, ...). A Slice 5 do plano anterior
já nomeou este arquivo (era 1072, hoje 978 — mal se moveu); é o maior débito de
manutenibilidade remanescente.

## P2 — Funções gigantes e monólitos mais novos

### 2.1 Funções gigantes dentro de serviços coesos

Os serviços em si são bem fatiados, mas escondem funções longas demais para
escanear:

- `src/services/billing.ts` — `listInvoiceDetails` ocupa `:433`→`:689`
  (**256 linhas** numa função).
- `src/services/voyageSummaries.ts` — `buildVoyageTimeline` ocupa
  `:455`→~`:740` (**~285 linhas**). O arquivo (851) é coeso (≈24 funções puras
  de sumarização), então a prioridade é quebrar **a função**, não o arquivo.

**Remédio.** Extrair as sub-etapas em funções puras nomeadas (ex.: por tipo de
evento na timeline; por seção do detalhe da fatura). Reduz a carga cognitiva sem
mover a lógica de camada.

### 2.2 Monólitos de aba mais recentes (não estavam no plano anterior)

- `src/components/taxasLocais/ChargeTablesTab.tsx` (712) — componente único
  `ChargeTablesTab` `:29`→`:710`.
- `src/components/billing/ValidacaoTab.tsx` (788) — corpo principal
  `:37`→`:679`.

Mesmo remédio das páginas P1: extrair subcomponentes/tabelas. Sinalizados como
P2 porque são abas (menos superfície que uma rota inteira), mas já cruzaram o
limiar de "difícil de escanear".

## P3 — Duplicata pontual

### 3.1 `formatCountLabel` copiado verbatim

Assinatura e corpo idênticos em `src/pages/Clientes.tsx:994` e
`src/components/taxasLocais/ChargeTablesTab.tsx:710`. Mover para
`src/lib/utils.ts` e importar dos dois lados. Diff mínimo, apaga uma cópia.

## Veredito (barra de aprovação do skill)

O galho auditado está limpo (nada a commitar); esta é uma auditoria de projeto
inteiro, não de um diff. Contra a barra do skill:

- **Sem regressão estrutural nova.** Ao contrário — a rodada anterior removeu a
  inversão de camada, o parser numérico frágil e um monólito de 1089 linhas.
- **Débito de decomposição remanescente**, com caminho claro em todos os casos:
  dois componentes-página de ~1k linhas (P1.3, P1.4) e duas abas (P2.2).
- **Duplicação de helper canônico** com rollout incompleto (P1.1, P1.2, P3.1) —
  presumível bloqueador pela regra "reusar o dono canônico existente", mas todos
  com correção de subtração de código.

Nenhum achado é "polir a mesma ideia bagunçada": cada remédio ou reusa uma
abstração que já existe ou aplica um padrão de decomposição que o repositório já
domina.

## Ordem sugerida de execução (barato → alto valor)

1. **P1.2** delegar `demurragePresentation.fmtBRL` ao canônico — diff de 1 linha.
2. **P3.1** mover `formatCountLabel` para `lib/utils.ts`.
3. **P1.1** estender `ui/PreviewBox` e deletar as 6 cópias.
4. **P2.1** extrair sub-funções de `listInvoiceDetails` e `buildVoyageTimeline`.
5. **P1.3 / P1.4** decompor `Clientes.tsx` e `Demurrage.tsx` (maior esforço,
   maior retorno de manutenibilidade).
6. **P2.2** decompor `ChargeTablesTab.tsx` e `ValidacaoTab.tsx`.

Cada slice deve passar pelos gates de `WORKFLOW.md`: `npm run docs:check`,
`npm run lint`, `npm test`, `npm run build`.
