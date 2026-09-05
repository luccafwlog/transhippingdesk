# Auditoria — performance, renderização React e experiência do operador

> **Snapshot histórico.** Este documento descreve o repositório e o projeto
> Supabase de produção em 2026-09-05. Para o estado atual, consulte o código e
> o banco.

**Data:** 2026-09-05 · **Branch:** `claude/transhipping-performance-audit-6z2p43` ·
**Escopo:** camada cliente (React 19, TanStack Query v5, Vite 8) — over-fetching,
re-render, comportamento offline, acessibilidade das telas densas.
**Rótulos de evidência:** [`docs/CONVENCOES.md`](../../CONVENCOES.md).

---

## Antes de ler: a premissa do pedido está parcialmente errada

O pedido assume um sistema sofrendo com volume ("milhares de linhas de B/Ls",
"DOM sobrecarregado", "Web Vitals"). **Isso não é o que os dados mostram.**

**Evidência: Runtime** (`pg_stat_user_tables` + `count(*)`, projeto
`fgmkhbzhaeebrsizwccx`, 2026-09-05):

| Tabela | Linhas hoje |
|---|---|
| `alert_item_events` | 11.523 |
| `audit_logs` | 269 |
| `voyages` | 36 |
| `bls` | **0** |
| `bl_containers` | **0** |
| `vehicles` | **0** |
| `customers` | **0** |

Os dados operacionais foram zerados (ver
[`docs/operations/reset-ambiente.md`](../../operations/reset-ambiente.md)). A
auditoria anterior
([2026-08-12](2026-08-12-investigacao-lentidao-carregamento-paginas.md)) já havia
medido o pico histórico: 135 B/Ls, 1.112 containers, 1.378 veículos — e concluído
que **volume não era gargalo**. O
[baseline de banco de 2026-08-13](../reports/2026-08-13-baseline-performance-producao.md)
fechou a mesma conclusão do lado do Postgres: 32 ms na consulta mais cara.

Três consequências para este relatório, ditas na cara:

1. **Não existe medição de CPU/memória de produção a ser feita hoje.** Um
   profile do navegador contra a base atual mediria uma tela vazia. Toda
   afirmação abaixo é **Código** — leitura estática do custo algorítmico — e
   não **Runtime**. Onde eu digo "vai doer", é projeção declarada, não medição.
2. **Nenhum dos achados é uma emergência de performance hoje.** São dívidas de
   escala: o código foi escrito com custo O(tabela) em pontos onde o banco já
   oferece filtro e paginação. O sintoma aparece na primeira safra grande de
   B/Ls, não antes.
3. **A pergunta "há virtualização de lista?" está mal calibrada** para este
   sistema. As telas densas já paginam em 20/50/100 linhas
   (`src/hooks/usePageFilters.ts:3`). Virtualizar uma tabela de 100 linhas é
   otimização prematura que custa acessibilidade (`Ctrl+F` do navegador, leitor
   de tela, impressão). O detalhe está em [§4](#4-virtualização-onde-sim-onde-não).

O que **é** real e vale corrigir está abaixo, ordenado por custo × probabilidade.

---

## Sumário dos achados

| # | Achado | Custo | Onde | Evidência |
|---|---|---|---|---|
| 1 | Busca livre sem debounce dispara varredura completa de `bls` com 5 embeds a **cada tecla** | Alto (escala) | `useBlSummary`, `useBls` | Código |
| 2 | `useContainers` materializa a tabela inteira no navegador para filtrar e paginar em JS | Alto (escala) | `src/hooks/useBls.ts:99` | Código |
| 3 | `useVoyages` carrega todas as viagens com 6 níveis de embed, e abre um waterfall de 2 fases | Alto (escala) | `src/hooks/useBls.ts:336` | Código |
| 4 | Zero memoização de render em todo o `src/` — nenhum `React.memo` | Médio | global | Código |
| 5 | `LineUpTVDisplay` repete um waterfall serial de 5 etapas a cada 30 s, 24/7 | Médio | `src/pages/LineUpTVDisplay.tsx:50` | Código |
| 6 | Vazamento de listeners: `useMemo` usado como `useEffect` | Baixo | `Containers.tsx`, `Manifestos.tsx` | **Teste** — corrigido nesta mudança |
| 7 | Offline: query pausada aparece como "nenhum registro", não como "sem conexão" | Médio (UX) | global | Código |
| 8 | `--app-muted-soft` reprova em contraste AA (3,03–3,68:1) em 78 usos | Médio (a11y) | `src/index.css:23` | Código |
| 9 | Tabelas sem `aria-sort` e sem `<caption>`; zero ocorrências no repositório | Baixo (a11y) | global | Código |

---

## 1. Os cinco maiores gargalos de CPU e memória

### 1.1 — Varredura completa de `bls` a cada tecla digitada

**Evidência: Código.** `useBlSummary` (`src/hooks/useBls.ts:135`) chama
`fetchAllBls`, que faz um laço de paginação de 1.000 em 1.000 até esgotar a
tabela, com este `select`:

```
*, customer(...), voyage(...vessel(...carrier(...))),
bl_containers(15 colunas), bl_freight_lines(8 colunas), bl_breakbulk_items(8 colunas)
```

A `queryKey` do resumo é `toSummaryFilters(filters)`, que remove **apenas**
`page` e `pageSize` — `search` continua na chave (`src/hooks/useBls.ts:582`). O
campo de busca de `/manifestos` grava direto no filtro, sem debounce:

```tsx
// src/pages/Manifestos.tsx:230
onChange={(event) => updateFilter('search', event.target.value)}
```

Resultado: digitar `CE-2026-001` (11 caracteres) produz **11 chaves de cache
distintas**, cada uma disparando uma varredura completa de `bls` com os cinco
embeds — e mantendo as 11 respostas vivas no cache do TanStack Query pelo
`gcTime` padrão de 5 minutos.

O mesmo caminho é reusado por `useBls` quando o operador filtra por
`cargoProfile` ou `chargeStatus` (`src/hooks/useBls.ts:68`) — aí a paginação
some e a página inteira passa a ser servida a partir de um `slice()` em memória.

**Custo projetado.** A 2.000 B/Ls × ~12 containers, uma resposta dessas passa de
20 MB de JSON. Multiplicado por 11 teclas, com todas retidas no cache: a aba
morre por memória antes de o operador terminar de digitar.

**Correção.**
- Debounce de 300 ms no campo (o projeto já tem a constante e o padrão em
  `src/components/ui/Combobox.tsx:28`) — remove 10 das 11 requisições, ~30 min
  de trabalho, zero risco.
- Tirar `search` da chave do resumo: o KPI de topo raramente precisa reagir ao
  texto livre; se precisar, ele deve vir de uma RPC de agregação, não de um
  `rows.filter()` no cliente (`src/hooks/useBls.ts:142-148`).
- Substituir `fetchAllBls` por uma RPC `bl_summary(filters)` que devolve sete
  inteiros. Os seis `filter()` do resumo são `count(*) FILTER (WHERE ...)` em SQL.

### 1.2 — `useContainers` pagina em JavaScript, não em Postgres

**Evidência: Código.** O próprio código admite (`src/hooks/useBls.ts:99`):

```ts
// ponytail: este filtro materializa todos os B/Ls/containers no cliente (O(tabela))
// para preservar filtros derivados; upgrade path = agregacao/filtros server-side.
```

O comentário `ponytail:` está correto e nomeia o teto — isso é a convenção do
projeto funcionando. O que ele não diz é que a página **soma três** varreduras
completas por carregamento:

| Hook | O que varre | Para quê |
|---|---|---|
| `useContainers` | `bls` + todos os embeds | listar 20 containers |
| `usePortOptions` | `bls` inteira (`pol, pod`) | preencher dois `<select>` |
| `useContainerTypeOptions` | `bl_containers` inteira (`type`) | preencher um `<select>` |

Os dois últimos existem só para montar combos de valores distintos. Isso é
`SELECT DISTINCT` — uma view ou RPC de ~10 linhas, resposta de poucos KB, com
`staleTime` alto (já são 10 min, o que ajuda mas não muda o custo da primeira
carga).

**Correção.** Nesta ordem de retorno sobre esforço:
1. `create view bl_port_options as select distinct pol, pod from bls` (+ idem
   para tipos de container). Elimina duas varreduras por página, ~1 h.
2. Mover `search`, `containerType` e `vehicleContainer` para o servidor —
   `search` já é aplicado por `normalizeText().includes()` no cliente
   (`src/hooks/useBls.ts:578`), o que é um `ilike` disfarçado.
3. `cargoProfile` (OOG/IMO) e a contagem de containers distintos exigem
   agregação — candidatos naturais a uma RPC única que devolve linhas + KPIs.

### 1.3 — `useVoyages`: um embed de seis níveis e um waterfall de duas fases

**Evidência: Código.** `src/hooks/useBls.ts:336` monta uma única query com:

```
voyages → vessel → carrier
        → import_batches
        → granite_manifests → granite_bls
        → vazios_manifests  → vazios_bookings → operation, local
        → bls → bl_containers (9 colunas), bl_breakbulk_items
```

sem `limit`, em laço de 1.000. Todos os containers de todos os B/Ls de todas as
viagens, em uma resposta — para desenhar uma faixa de cards
(`VoyageRail`) que exibe contagens agregadas.

Pior: `voyageIds` é derivado **do resultado** dessa query
(`src/pages/Viagens.tsx:152`), e nove outras queries dependem dele
(`useVoyageVehicleStats`, `useVaziosImportacaoStats` e as sete de
`useViagemSchedulesAndStats`). A página tem duas fases obrigatoriamente serial:
a query mais pesada do sistema **precede** todas as outras. É o achado D da
auditoria de 2026-08-12, ainda vivo.

**Correção.** A faixa precisa de ~10 campos por viagem, todos agregáveis:
`blCount`, `containerCount`, cobertura de CE, flags de módulo. Uma view
`voyage_rail_summary` os entrega em uma linha por viagem — resposta de KB, e
`voyageIds` fica disponível imediatamente, colapsando o waterfall para uma fase.
Este é o item de maior retorno da auditoria inteira e o mais caro (~2 dias).

### 1.4 — Zero memoização de render em todo o `src/`

**Evidência: Código.**

```
$ grep -rn "React.memo\|memo(" --include=*.tsx src | grep -v useMemo
(nenhum resultado)
```

29 usos de `useCallback` em ~950 arquivos. Consequência concreta: em
`/containers`, cada tecla no campo de busca troca `filters`, o que re-renderiza
`Containers` inteira — cabeçalho, dez `<Field>`, cinco `MetricCard`, o card de
resumo por tipo e as 20 linhas da tabela com seus badges. A tabela não depende
do texto (ela vem de `data`), mas re-renderiza junto porque nada a isola.

**Correção — na ordem que importa:**
1. **Debounce primeiro.** Ele elimina ~90% dos renders na origem. Sem debounce,
   memoizar é tapar o sintoma.
2. Extrair a linha da tabela para um componente com `React.memo` **apenas nas
   telas que renderizam ≥50 linhas** e com props escalares (`bl.id`, strings),
   não objetos recriados. Memoizar linha com prop-objeto instável é custo puro.
3. `useCallback` só nos handlers passados a componentes memoizados. Espalhar
   `useCallback` sem `React.memo` do outro lado não economiza nada — é ruído.

Um aviso honesto: React 19 tem o compilador, mas este projeto **não o usa**
(`vite.config.ts` carrega `@vitejs/plugin-react` sem `babel-plugin-react-compiler`).
Habilitá-lo resolveria a maior parte deste item sem escrever `memo` à mão, e é
uma experiência de meio dia — vale tentar antes de memoizar manualmente.

### 1.5 — Line Up de TV: waterfall serial repetido a cada 30 s, para sempre

**Evidência: Código.** `src/pages/LineUpTVDisplay.tsx:50` usa
`refetchInterval: 30_000`. O `queryFn` é
(`src/services/lineup.ts:474-620`) uma cadeia estritamente serial:

`voyages (limit 60)` → `bls` por chunk de 25 viagens → `bl_containers` por chunk
de 250 B/Ls → `vehicles` → manifestos de vazios → containers de vazios.

Cada etapa tem laço de paginação próprio. É a única tela do sistema que roda em
loop, tipicamente numa TV que fica ligada o dia inteiro — 2.880 execuções por
dia deste waterfall.

**Correção.** Uma RPC `lineup_snapshot()` que faz os `join`/`count` em SQL e
devolve as ~60 linhas prontas. É o caso mais claro de todo o relatório: o dado
é agregado, o consumidor é read-only e a repetição é infinita.

---

## 2. Bug corrigido nesta mudança: vazamento de listeners

**Evidência: Teste.** `src/pages/Containers.tsx` e `src/pages/Manifestos.tsx`
registravam quatro listeners globais (`scroll`, `resize`, `keydown`,
`mousedown`) dentro de um **`useMemo`**:

```tsx
useMemo(() => {
  if (!actionsMenu) return
  window.addEventListener('scroll', close, true)
  // ...
  return () => { window.removeEventListener('scroll', close, true) /* ... */ }
}, [actionsMenu])
```

O React **descarta** o valor de retorno de um `useMemo` — a função de limpeza
nunca é chamada. Cada abertura do menu "⋯" de uma linha somava quatro listeners
permanentes, e eles sobreviviam à navegação para outra rota. Num turno de
trabalho com dezenas de aberturas, é vazamento de memória **e** de CPU: cada
evento de `scroll` passa a executar N callbacks obsoletos que chamam `setState`
em componentes desmontados.

Corrigido para `useEffect` nos dois arquivos, com a função de fechamento local
ao efeito (`setActionsMenu` é estável, o que mantém a lista de dependências
correta). O teste de regressão está em
`src/pages/__tests__/Manifestos.behavior.test.tsx` — verificado que **falha** no
código anterior e passa no atual.

Este é o único achado de memória com efeito **hoje**, na base vazia: ele não
depende de volume de dados.

---

## 3. Redes instáveis e offline

### 3.1 — O que já funciona (e não precisa mexer)

**Evidência: Código.** A edição de atracação citada no pedido está bem
construída:

- `EscalaModal` mantém o modal aberto e o formulário preenchido quando o
  `onSaved` rejeita (`src/components/shared/VoyageScheduleModals.tsx:955`) — não
  há perda de digitação nem tela branca.
- Há controle otimista de concorrência com revisão: `REVISAO_OBSOLETA` vira a
  mensagem "A escala foi atualizada por outra pessoa"
  (`src/pages/Viagens.tsx:489`).
- `ErrorBoundary` tem variante `route`, que preserva header e navegação e reseta
  por `pathname` (`src/components/ErrorBoundary.tsx:38`).
- O retry global só reexecuta erros reconhecidamente transitórios
  (`isRetriableDbError`, `src/lib/queryClient.ts:27`) — não repete erro de
  validação.

A hipótese "quebra com tela branca" do pedido **não se confirma**.

### 3.2 — O que falha: offline vira "nenhum registro"

**Evidência: Código** (`node_modules/@tanstack/query-core`, versão instalada):

```js
// retryer.js:10  — o default é "online"
function canFetch(networkMode) {
  return (networkMode ?? "online") === "online" ? onlineManager.isOnline() : true;
}
// queryObserver.js:310
const isLoading = isPending && isFetching;
```

Com o operador offline, a query **não dispara**: fica em `fetchStatus: 'paused'`.
Como `isFetching` é `false`, `isLoading` também é `false`. As páginas ramificam
em `isLoading ? <Skeleton/> : <Tabela/>` — então o operador sem rede vê a tabela
**vazia**, com o `EmptyState` "Nenhum registro encontrado". Ele conclui que o dado
sumiu, não que a rede caiu.

```
$ grep -rn "isPaused\|fetchStatus" --include=*.ts --include=*.tsx src
(nenhum resultado fora de testes)
```

Não há tratamento de `isPaused` em lugar nenhum, nem indicador global de
reconexão.

**Correção (barata e de alto impacto percebido):**
1. Uma faixa global em `AppLayout` assinando `onlineManager.subscribe(...)`:
   "Sem conexão — os dados exibidos podem estar desatualizados." ~2 h.
2. Nos guards das páginas densas, trocar `isLoading ?` por
   `isLoading || isPaused ?` e distinguir a mensagem. Alternativamente, um
   componente `QueryStateGate` que encapsula os três estados
   (`paused` / `loading` / `empty`) e substitui as ramificações espalhadas.

### 3.3 — Debounce: existe, mas só no lugar certo pela metade

**Evidência: Código.** O `Combobox` (`src/components/ui/Combobox.tsx:28`) tem
debounce de 300 ms bem implementado — inclusive ignorando o disparo inicial
semeado pela URL. É o padrão certo e já está no repositório.

Mas ele só cobre os campos com autocomplete. Os campos de texto livre das telas
de lista escrevem direto no filtro, sem debounce:

| Tela | Linha |
|---|---|
| `/manifestos` | `src/pages/Manifestos.tsx:230` |
| `/containers` | `src/pages/Containers.tsx:196` |
| `/carga-solta` | `src/pages/CargaSolta.tsx:196` |
| `/veiculos` | `src/pages/Veiculos.tsx:380` |
| `/granito` | `src/pages/Granite.tsx:210` |
| `/vazios-importacao` | `src/pages/VaziosImportacao.tsx:230` |
| `/viagens` | `src/components/voyages/VoyageFilters.tsx:61` |

**Correção.** Um `useDebouncedValue(value, 300)` em `src/hooks/`, aplicado no
valor que entra na `queryKey` (mantendo o `<input>` controlado sem atraso, para
não engasgar a digitação). ~2 h para as sete telas. É a correção de melhor
relação custo/benefício de todo o relatório.

---

## 4. Virtualização: onde sim, onde não

Discordo de virtualizar as telas citadas no pedido. O critério:

| Tela | Linhas no DOM | Veredito |
|---|---|---|
| `/manifestos`, `/containers`, `/carga-solta`, `/veiculos` | 20–100 (paginado) | **Não virtualizar.** 100 linhas não sobrecarregam DOM nenhum. Virtualizar quebra `Ctrl+F`, impressão e leitor de tela — perda líquida. |
| `/chegadas-saidas` | todas as viagens do Portal, sem paginação (`src/pages/ChegadasSaidas.tsx:350`) | **Talvez.** Paginar ou filtrar por janela de data primeiro; virtualizar só se passar de ~300 linhas. |
| `VoyageRail` (faixa de `/viagens`) | todas as viagens, scroll horizontal (`src/components/voyages/VoyageRail.tsx`) | **Talvez.** Mesmo raciocínio; hoje são 36 viagens. |
| `LineUpTVDisplay` | ≤60 por construção (`limit(60)`) | **Não.** Já limitado. |

Ou seja: **nenhuma tela justifica virtualização hoje**, e nenhuma justificaria
com a base de pico histórico (135 B/Ls). O problema real dessas telas é a
quantidade de **dados buscados**, não a de nós renderizados — §1. Adicionar
`@tanstack/react-virtual` agora seria resolver o sintoma errado e pagar em
acessibilidade por isso.

O gatilho para reavaliar: quando `/chegadas-saidas` ou a faixa de `/viagens`
passarem de ~300 itens sem filtro. Aí, paginação ou janela de data antes de
virtualização.

---

## 5. Acessibilidade e micro-interações

### 5.1 — Confirmação de ações destrutivas: bom, com duas exceções

**Evidência: Código.** Existe um `ConfirmDialogProvider` correto — promessa,
foco preso, `tone: 'danger'`, `Esc` fecha
(`src/components/ui/ConfirmDialog.tsx`) — usado em 21 pontos. As ações citadas
no pedido estão cobertas com deliberação real:

| Ação | Fricção exigida |
|---|---|
| Cancelar viagem | Motivo obrigatório **+** diálogo de confirmação (`src/pages/Viagens.tsx:215`) |
| Reverter omissão de escala | Justificativa obrigatória em modal próprio (`src/components/voyages/TransshipmentInfoCard.tsx:80`) |
| Excluir viagem | Modal dedicado, texto explicando irreversibilidade |
| Excluir containers | Relatório de dependências antes da confirmação (`src/pages/Containers.tsx`) |

Duas exceções que destoam do padrão:

1. **`window.confirm()` nativo em quatro pontos** —
   `src/pages/ChegadasSaidas.tsx:294` (remover navio do Portal),
   `src/pages/ClientesComunicacao.tsx:363` e `:389` (**ligar/desligar a chave
   global de envio de e-mail real aos clientes**) e
   `src/components/billing/InvoiceCommunicationStatusCell.tsx:63`. O caso da
   chave global é o mais grave: é a ação de maior alcance externo do sistema, e
   está atrás de um diálogo do navegador — sem tom de perigo, sem rótulo de
   botão específico, bloqueando a thread. Deve usar o `ConfirmDialogProvider`
   com `tone: 'danger'`.
2. **Fechamento por clique no backdrop, sem guarda** — `Modal`
   (`src/components/ui/Modal.tsx:81`) chama `onClose` em qualquer clique fora.
   Em `EscalaModal`, um formulário longo, um clique acidental descarta tudo sem
   aviso. Sugestão: `dismissible={false}` para modais de edição, ou confirmação
   de descarte quando o formulário estiver sujo.

### 5.2 — Contraste: um token reprova em AA, em 78 usos

**Evidência: Código.** Razões calculadas sobre os tokens de
`src/index.css` (WCAG 2.1, texto normal exige 4,5:1):

| Par | Razão | AA |
|---|---|---|
| `--app-muted` sobre `--app-surface` (claro) | 7,42:1 | ✅ |
| `--app-muted` sobre `--app-surface-strong` (escuro) | 7,09:1 | ✅ |
| **`--app-muted-soft` sobre `--app-surface` (claro)** | **3,68:1** | ❌ |
| **`--app-muted-soft` sobre `--app-panel` (claro)** | **3,03:1** | ❌ |
| **`--app-muted-soft` sobre `--app-surface-strong` (escuro)** | **3,65:1** | ❌ |
| **`--app-gold` sobre `--app-surface` (claro)** | **2,85:1** | ❌ (reprova até 3:1) |
| `--app-green` sobre `--app-surface` (claro) | 4,28:1 | ❌ (marginal) |

`--app-muted-soft` aparece 62 vezes em `.tsx` e 16 em `index.css`, quase sempre
em tamanhos de 10 a 12 px — a combinação mais difícil possível. E não é
decoração: em `/chegadas-saidas`, o marcador **`OMIT`** (escala omitida pelo
armador) é renderizado exatamente nesse token
(`src/pages/ChegadasSaidas.tsx:24`). Informação operacional relevante, no menor
contraste da paleta. Para uso intensivo, oito horas por dia, isso é fadiga
visual mensurável.

**Correção.** Escurecer `--app-muted-soft` para ≥4,5:1 nos dois temas — no tema
claro, algo em torno de `#6b6558`; no escuro, em torno de `#8a9bb4`. É uma
mudança de duas linhas que atinge 78 pontos de uso. Estados semânticos
(`--app-gold`, `--app-green`) precisam de variantes `-text` mais escuras quando
usados como texto, mantendo as atuais para preenchimento e borda.

### 5.3 — Navegação por teclado nas tabelas

**Evidência: Código.**

- ✅ `Modal` tem armadilha de foco completa, `Esc`, e devolve o foco ao elemento
  anterior (`src/components/ui/Modal.tsx:38-76`).
- ✅ `Combobox` implementa o padrão ARIA de combobox com `aria-activedescendant`.
- ✅ `scope="col"` aplicado consistentemente nas tabelas.
- ❌ **Zero `aria-sort`** no repositório — colunas ordenáveis não anunciam o
  estado de ordenação.
- ❌ **Zero `<caption>`** — nenhuma tabela tem nome acessível; o leitor de tela
  anuncia "tabela com 12 colunas" sem dizer de quê.
- ⚠️ O menu de ações "⋯" abre por clique e posiciona por coordenada
  (`position: fixed`), sem `role="menu"`, sem mover o foco para o primeiro item
  e sem devolvê-lo ao gatilho ao fechar. Ele fecha com `Esc` (bom), mas não é
  navegável por teclado de ponta a ponta.
- ⚠️ `<tr onClick>` sem handler de teclado em `src/pages/ClientesPortal.tsx` e
  `src/pages/PortalOperacao.tsx` — linha clicável inacessível por teclado.

---

## 6. Plano de ação

Ordenado por (impacto percebido pelo operador) ÷ (esforço). As fases 1 e 2
cabem numa semana e entregam quase toda a melhoria percebida; a fase 3 é o
trabalho estrutural que só se paga com volume.

### Fase 1 — Dias 1–2: o que o operador sente amanhã

| # | Ação | Esforço | Risco |
|---|---|---|---|
| 1.1 | `useDebouncedValue(300)` nos 7 campos de busca livre | 2 h | Baixo |
| 1.2 | Indicador global de offline via `onlineManager` no `AppLayout` | 2 h | Baixo |
| 1.3 | Tratar `isPaused` nos guards de carregamento das telas de lista | 3 h | Baixo |
| 1.4 | `--app-muted-soft` e variantes de texto para gold/green em ≥4,5:1 | 2 h | Baixo |
| 1.5 | Trocar os 4 `window.confirm()` pelo `ConfirmDialogProvider` | 2 h | Baixo |
| — | ~~Vazamento de listeners (`useMemo` → `useEffect`)~~ | — | **Feito** |

### Fase 2 — Dias 3–5: tirar as varreduras evitáveis

| # | Ação | Esforço | Risco |
|---|---|---|---|
| 2.1 | Views `DISTINCT` para `usePortOptions` e `useContainerTypeOptions` | 4 h | Baixo — migration aditiva |
| 2.2 | RPC `bl_summary(filters)` substituindo `fetchAllBls` em `useBlSummary` | 1 d | Médio — precisa espelhar a semântica atual dos filtros |
| 2.3 | `search`/`containerType` de `/containers` para o servidor | 4 h | Médio |
| 2.4 | RPC `lineup_snapshot()` para a TV | 1 d | Baixo — consumidor read-only, isolado |
| 2.5 | `aria-sort` + `<caption>` nas tabelas de lista | 4 h | Baixo |

### Fase 3 — Semana 2+: estrutural

| # | Ação | Esforço | Risco |
|---|---|---|---|
| 3.1 | View `voyage_rail_summary`; colapsar o waterfall de 2 fases de `/viagens` | 2 d | Médio-alto — é o coração da tela mais usada |
| 3.2 | Avaliar `babel-plugin-react-compiler` antes de memoizar à mão | 4 h de spike | Baixo — reversível |
| 3.3 | `React.memo` nas linhas de tabela **só** se 3.2 não resolver | 1 d | Baixo |
| 3.4 | Padrão de foco/`role="menu"` no menu de ações "⋯" | 4 h | Baixo |
| 3.5 | Modais de edição sem descarte por clique no backdrop | 3 h | Baixo |

### O que eu explicitamente **não** recomendo

- **Virtualização de lista.** Nenhuma tela a justifica hoje (§4). Reavaliar
  quando `/chegadas-saidas` ou a faixa de `/viagens` passarem de ~300 itens.
- **Espalhar `useCallback`/`useMemo` preventivamente.** Sem `React.memo` do
  outro lado, é custo sem benefício, e polui a leitura do código.
- **Mexer em índices ou RLS.** O
  [baseline de 2026-08-13](../reports/2026-08-13-baseline-performance-producao.md)
  já mostrou que o banco está ocioso. O gargalo é a forma da consulta, não sua
  execução.

### Como validar que funcionou

O projeto já tem o instrumento certo:
`scripts/perf/measure-authenticated-startup.mjs` (Playwright, mede requisições,
bytes e as 10 mais lentas por categoria). Ele exige `PERF_BASE_URL`,
`PERF_USER_EMAIL` e `PERF_USER_PASSWORD`, que não estavam disponíveis nesta
auditoria.

**Recomendação:** rodá-lo contra um Preview com base semeada (~2.000 B/Ls) antes
e depois da Fase 2, com as métricas de aceitação abaixo. Sem essa semeadura, as
correções continuam sendo argumentos de código — corretos, mas não medidos.

| Métrica | Alvo |
|---|---|
| Requisições por tecla digitada na busca | 0 (uma por rajada, após 300 ms) |
| Bytes na primeira carga de `/containers` | −70% (fim de duas varreduras) |
| Bytes na primeira carga de `/viagens` | −90% (view de resumo) |
| Fases de rede em série em `/viagens` | 2 → 1 |
| Tokens de cor reprovando AA no texto | 3 → 0 |

---

## 7. Notas e divergências

- Este relatório **não** mediu Web Vitals, CPU ou memória em execução: a base de
  produção está sem dados operacionais e não havia credencial de teste para o
  harness autenticado. Toda estimativa de custo está rotulada como projeção.
- O achado 6 (vazamento de listeners) é o único corrigido nesta mudança. Todos
  os demais estão descritos com correção proposta, sem implementação — o pedido
  era de auditoria e plano.
- O achado 3 (`useVoyages`) recobre o achado D da auditoria de
  [2026-08-12](2026-08-12-investigacao-lentidao-carregamento-paginas.md), que
  segue aberto. O achado A daquela auditoria (Realtime) foi resolvido e
  confirmado pelo baseline de 2026-08-13.
