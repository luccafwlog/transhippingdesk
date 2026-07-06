# Auditoria de Qualidade de Código — 2026-07-06

Auditoria estrutural profunda do projeto inteiro (revisão "thermo-nuclear"),
executada sobre `main` em `4d3084f`. Registro histórico: reflete o estado do
código na data acima. Foco: estrutura, abstrações, duplicação, fronteiras de
camadas e teto de manutenibilidade — não bugs funcionais.

Escala do projeto: ~68,5 mil linhas de TypeScript/TSX em `src/`.

## Sumário executivo

O projeto está acima da média em higiene: zero `as any`, zero `TODO/FIXME`,
apenas 7 `eslint-disable`, serviços bem separados por domínio e documentação
viva incomum em qualidade. Os problemas encontrados são estruturais e
concentrados em três categorias:

1. **Abstração de página-de-lista ausente** — o mesmo bloco de
   filtros + paginação está copiado à mão em ~11 páginas.
2. **Inversão de camadas** — `src/pages/viagensHelpers.ts` (917 linhas) é
   importado por `src/lib/` e `src/components/`, invertendo a direção
   declarada em `docs/ARCHITECTURE.md`.
3. **Fragmentação de parsing numérico** — cinco parsers de número em formato
   BR com semânticas sutilmente diferentes, incluindo um caso de corrupção
   silenciosa de decimais em pesos e CBM.

Nenhum achado exige reescrita; todos têm um movimento de simplificação claro
que **apaga** complexidade em vez de rearranjá-la.

## P1 — Regressões estruturais e riscos de correção

### 1.1 `toNumber` corrompe decimais em formato US (peso, CBM, tara)

**Código.** `src/lib/utils.ts:121` remove todos os pontos antes de trocar
vírgula por ponto:

```ts
const normalized = value.replace(/\./g, '').replace(',', '.')
```

Uma célula de planilha com `"1.5"` (formato US, sem vírgula) vira `15` — erro
de 10× em peso ou volume, sem falha visível. Chamadores afetados incluem
`src/services/manifestParser.ts:168-169` (peso bruto e CBM),
`src/services/graniteImport.ts:109-149` (pesos e m³ do Granito) e
`src/services/vaziosImportacaoImport.ts:64` (tara).

**Suspeita.** O risco se materializa quando o XLSX entrega a célula como
string com ponto decimal (célula formatada como texto, CSV, ou exportadores
de armador). Quando a célula chega como `number` nativo o caminho é seguro.

Três parsers irmãos já tratam o caso corretamente distinguindo
"ponto+vírgula" de "só ponto": `src/services/blParser.ts:209`,
`src/services/breakbulkManifestParser.ts:826` e
`src/services/financialValidation.ts:12`.

**Remédio:** promover a variante correta (a de `blParser.ts`, que é a mais
robusta a sufixos de unidade) para `src/lib/utils.ts` como parser canônico e
deletar as outras quatro. Ver 2.2.

### 1.2 Inversão de camadas: `lib/` e `components/` importam de `pages/`

**Código.** `src/pages/viagensHelpers.ts` (917 linhas) é importado por
`src/lib/statusLabels.ts`, `src/lib/viagensFilters.ts` e por 7 componentes em
`src/components/voyages/` e `src/components/shared/`. A arquitetura declarada
é `pages → hooks → services`, com `lib/` como utilitários puros; aqui a seta
aponta para trás. O arquivo também mistura três coisas: utilitários puros de
formatação, tipos de domínio de viagem (`VoyageBl`, `VoyageTimelineEvent`) e
lógica de negócio (timeline, conciliação, cobertura de CE).

**Remédio:** mover o arquivo para fora de `pages/` — a lógica de domínio e os
tipos para `src/services/` (ex.: `src/services/voyageSummaries.ts`), os
utilitários puros para `src/lib/`. É quase só `git mv` + ajuste de imports;
nenhuma mudança de comportamento.

### 1.3 Código morto: `buildVoyageTimelineLegacy` (~120 linhas)

**Código.** `src/pages/viagensHelpers.ts:445-565` não tem nenhum chamador em
`src/` — nem em testes. Deletar.

## P2 — Oportunidade de simplificação dramática (code judo)

### 2.1 A abstração de página-de-lista que o projeto inteiro está pedindo

**Código.** Onze páginas repetem à mão o mesmo trio:

- constante `pageSizes = [20, 50, 100]` (`src/pages/CargaSolta.tsx:22`,
  `Containers.tsx:28`, `EmbarqueVazios.tsx:22`, `Granite.tsx:25`,
  `Manifestos.tsx:37`, `VaziosImportacao.tsx:25`, `Veiculos.tsx:23`, mais
  variações em `PortalOperacao.tsx:24` e `Baplie.tsx:469`);
- função local `updateFilter` com a mesma assinatura em 8 páginas;
- o rodapé completo de tabela (`app-table__footer` com `Select` de tamanho,
  contagem "Página X de Y · N registros" e botões Anterior/Próxima) — o
  markup de `src/pages/Manifestos.tsx:505-530` e
  `src/pages/Containers.tsx:480-505` é idêntico linha a linha exceto pelo
  texto da contagem.

Este é o maior movimento de simplificação disponível no projeto: um hook
`usePageFilters<T>` (estado de filtros + página + pageSize + `updateFilter`
com reset de página) e um componente `<TableFooterPagination>` em
`src/components/ui/` apagam ~11 cópias do mesmo bloco (~30 linhas cada) e
tornam a próxima página de lista trivial. Depois disso, cada página de lista
fica menor e a chance de as páginas divergirem em comportamento de paginação
desaparece por construção.

### 2.2 Cinco parsers numéricos onde deveria existir um

**Código.** Além do bug em 1.1, coexistem:

| Parser | Falha vira | `"1.5"` | `"1.234,56"` |
|---|---|---|---|
| `src/services/blParser.ts:209` | `null` | 1.5 | 1234.56 |
| `src/services/breakbulkManifestParser.ts:826` | `null` | 1.5 | 1234.56 |
| `src/services/financialValidation.ts:12` | `NaN` | 1.5 | 1234.56 |
| `src/services/manifestParser.ts:584` | `0` | 1.5 | 1.234 |
| `src/lib/utils.ts:121` (`toNumber`) | `null` | **15** | 1234.56 |

Quatro contratos de falha diferentes e duas semânticas de separador para o
mesmo problema (número em planilha BR/EN). **Remédio:** um único parser
canônico em `src/lib/utils.ts`, com os quatro locais convertidos e um teste
de tabela cobrindo os formatos acima.

### 2.3 Duplicatas de helpers com dono canônico já existente

**Código.**

- `chunkArray` é canônico em `src/lib/utils.ts:129`, mas
  `src/hooks/useVehicles.ts:303` e `src/services/lineup.ts:477,486` mantêm
  `chunkNumberArray`/`chunkStringArray` bespoke idênticos em intenção.
- `normalizePortCode` é canônico em `src/services/portCode.ts:15`, mas
  `src/services/breakbulkManifestParser.ts:442` reimplementa, e
  `src/services/lineup.ts:495` tem um `normalizePort` próprio.
- `normalizeHeader` duplicado entre `src/services/ceMercanteImport.ts:293` e
  `src/services/breakbulkManifestParser.ts:564`.
- Componente `PreviewBox` duplicado entre `src/pages/Clientes.tsx:963` e
  `src/pages/Manifestos.tsx:1053`.

Individualmente pequenos; em conjunto normalizam a cultura de "escrever de
novo em vez de procurar o dono". Consolidar todos no dono existente.

## P3 — Tamanho de arquivo e decomposição

### 3.1 Dois arquivos acima de 1.000 linhas, um a 9 linhas do limite

**Código.**

- `src/pages/Manifestos.tsx` — 1.089 linhas. O corte é óbvio:
  `UploadManifestModal` (linhas 603-1049, ~446 linhas) é um modal completo de
  importação com preview que mora dentro do arquivo da página. Extraído para
  `src/components/` (ao lado de `BlImportModal.tsx`, que já segue esse
  padrão), a página volta a ~640 linhas.
- `src/pages/Demurrage.tsx` — 1.072 linhas, sendo `Demurrage()` um único
  componente de ~920 linhas com **23 `useState`** e abas
  (`containers | clientes | invoices…`). `src/components/billing/` já hospeda
  `DemurrageInvoicesSection.tsx` e `src/services/demurrage/` já existe — as
  abas restantes deveriam seguir o mesmo caminho, uma por componente.
- `src/pages/Clientes.tsx` — 991 linhas; `Clientes()` sozinho tem ~877
  linhas e 13 `useState`. A próxima feature cruza o limite de 1k. Decompor
  antes disso (o formulário de contatos e a ficha de preview são cortes
  naturais).

## P4 — Fronteiras de tipo e contratos

### 4.1 `as unknown as` como ponte entre Supabase e tipos de domínio

**Código.** 39 ocorrências fora de testes, concentradas em
`src/hooks/useBls.ts` (6), `src/services/billingLedger.ts`,
`src/hooks/useVehicles.ts` e `src/hooks/useReview.ts` (3 cada). O padrão é
sempre o mesmo: uma string `select` com joins e o resultado forçado para um
tipo de domínio escrito à mão (`(data ?? []) as unknown as BLListItem[]`,
`src/hooks/useBls.ts:79`). O cast dupla-etapa desliga a checagem exatamente
na fronteira mais frágil do sistema — se a string `select` divergir do tipo,
o compilador não vê.

**Remédio (incremental):** para as consultas mais quentes, derivar o tipo da
própria query (padrão `QueryData` do supabase-js) ou validar a borda com
`zod` (já é dependência) — e concentrar cada string `select` num único lugar
por entidade, para o cast (enquanto existir) ter um dono só.

### 4.2 `queryKeys.ts` existe, mas 225 chaves inline competem com ele

**Código.** `src/services/queryKeys.ts` é o dono declarado das chaves de
cache, porém só 5 hooks o importam; há 225 `queryKey: [...]` inline em
`src/hooks/` e `src/pages/`. Duas convenções competindo é pior do que uma
convenção fraca: invalidações que dependem de prefixo casando com string
literal quebram em silêncio quando alguém renomeia só um dos lados.
**Remédio:** decidir — ou migrar as chaves de verdade para `queryKeys.ts`
(pode ser módulo a módulo), ou deletar o arquivo e documentar a convenção
inline. O estado híbrido é o pior dos três.

## P5 — Orquestração

### 5.1 Lista paginada que baixa a tabela inteira a cada filtro

**Código.** `src/hooks/useBls.ts:90` (`useContainers`) chama
`fetchAllContainers` → `fetchAllBls`, que pagina **o resultado completo** do
servidor em lotes num `while (true)` (linha 149) e depois fatia a página no
cliente. O mesmo caminho serve os KPIs (onde faz sentido) e a listagem
paginada (onde é um teto de escala: custo O(tabela) por mudança de filtro).
Não há comentário `ponytail:` nomeando o teto, como a convenção do projeto
exige para simplificações intencionais.

**Remédio:** se o volume atual torna isso aceitável, marcar com `ponytail:`
nomeando o teto e o caminho de upgrade (agregação server-side para o
agrupamento por tipo). Se não, mover a paginação para o servidor como já é
feito em `useBLs` no caminho sem ordenação custom.

## O que está bom (e deve ser preservado)

- **Código.** Zero `as any`, zero `TODO/FIXME/HACK`, 7 `eslint-disable` em
  68k linhas — disciplina rara.
- **Código.** `src/services/` particiona o domínio com nomes claros;
  `charges/` e `demurrage/` já mostram o padrão de submódulo correto.
- **Código.** Formatadores quase todos com dono único (só `formatShortDate`,
  `formatNumber` e `formatInteger` têm 2 definições cada).
- Documentação viva (`ARCHITECTURE.md`, `RASTREABILIDADE.md`, ADRs) acima do
  padrão da indústria e verificada por `npm run docs:check`.

## Ordem de ataque recomendada

1. Parser numérico canônico + deletar `toNumber` atual (1.1 + 2.2) — menor
   esforço, maior risco eliminado.
2. Deletar `buildVoyageTimelineLegacy` (1.3) — 5 minutos.
3. Mover `viagensHelpers.ts` para fora de `pages/` (1.2).
4. `usePageFilters` + `<TableFooterPagination>` (2.1), migrando as páginas
   aos poucos.
5. Extrair `UploadManifestModal` e decompor `Demurrage`/`Clientes` (3.1)
   junto com a próxima feature que tocar cada página.
6. Consolidar helpers duplicados (2.3) oportunisticamente, e decidir o
   destino de `queryKeys.ts` (4.2).
