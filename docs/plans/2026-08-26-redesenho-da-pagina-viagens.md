# Redesenho da página `/viagens`

**Status:** TODO
**Origem:** sessão de design de 2026-08-25/26 — PR #588, que entrega apenas as
fontes do canvas (`artifacts/design-viagens/`) e nenhuma linha de `src/`.
**Canvas:** os artboards versionados em `artifacts/design-viagens/*.dc.html` são
a referência visual. Cada aba tem um par antes/depois lendo os mesmos dados; o
"antes" é transcrição fiel do componente atual.

Cada aba é uma entrega independente e deve virar **um PR próprio**. O desenho já
está fatiado assim; juntar as cinco num diff só inviabiliza a revisão.

---

## Vocabulário fixado nesta sessão

Estes termos foram decididos e valem para todas as abas:

- **Rotas e Manifestos** — nome novo da aba antes chamada "Escalas & Manifestos".
- **CE Mercante** — cobertura por B/L, relação 1:1.
- **Nº de manifesto Mercante** — o agregador por rota (antes exibido como
  "Master — número da rota").
- **Containers descarregados** — nome do painel antes chamado "Descarga de
  importação", que sugeria exportação sendo descarregada.
- **Destino final** / **Em transbordo** — os dois destinos da carga
  descarregada. Ambos desceram na escala; o segundo só não tem ali o destino
  final, porque o `pod` do B/L aponta para o porto que o navio omitiu.
- **Natureza** do container — `carga geral`, `IMO`, `OOG`. Transbordo **não** é
  natureza (é destino) e veículo **não** é natureza (tem seção própria).

---

## Bloco 0 — Fundação (fazer antes de qualquer aba)

Sem migration. Só leitura e tokens.

### 0.1 `is_oog` não chega ao ADR

`is_oog` existe em `baplie_containers` e em `bl_containers`
(`src/types/database.ts`), mas nenhum dos dois selects do ADR o traz:

- `src/services/agencyDepartureReport.ts:761` — `BL_CONTAINERS_SELECT`
- `src/services/agencyDepartureReport.ts:~893` — select de `baplie_containers`

Adicionar `is_oog` aos dois, propagar até `AgencyReportDischargeContainer`.

### 0.2 `MatrixCategory` ganha `oog`

Em `src/services/agencyDepartureReport.ts`:

- `MatrixCategory` (~589) ganha `'oog'`
- `MATRIX_CATEGORY_LABELS` (~613) ganha `oog: 'OOG'`
- `CATEGORY_PRIORITY` (~1074) posiciona `oog`

**Regra decidida: OOG vence IMO.** `is_imo` e `is_oog` são booleanos
independentes — um container pode ser os dois. A listagem precisa de uma regra
declarada, e esta segue o espírito do `CATEGORY_PRIORITY` que já existe
(`transbordo > veículos > imo > carga_geral`). A tela mostra quantos caem nos
dois casos, para o número não parecer errado.

Prioridade final: `transbordo > veiculos > oog > imo > carga_geral`.

### 0.3 Compatibilidade com snapshots fechados

`closed_snapshot` guarda `sections.cargaDescarregada` com as categorias vigentes
no fechamento. O impresso resolve rótulo por
`MATRIX_CATEGORY_LABELS[category] ?? category`, então snapshot antigo com
`vazio` continua legível sem mudança. **Não reescrever snapshots.**

### 0.4 Duas cores fora dos tokens

- `src/components/shared/FileImportModal.tsx` — a barra de preview usa
  `border-[#30363d] bg-[#0d1117] text-slate-300`, cores de tema escuro dentro de
  um modal claro. Trocar por `--app-border` / `--app-surface-muted` /
  `--app-muted`.
- `EscalaDivergenceWarning` (`src/components/voyages/VoyageVisaoTab.tsx`) — usa `text-amber-400` (#fbbf24) a 11px sobre
  superfície clara. Trocar por `--app-gold-strong` no peso do `.app-badge`.

---

## Bloco 1 — Visão geral · Planejamento por escala

**Arquivo:** `src/components/voyages/VoyageVisaoTab.tsx`
**Artboards:** `PlanejamentoAntes.dc.html` → `PlanejamentoEscala.dc.html`

1. Cabeçalho de dois níveis na coluna de chegada: `Chegada` agrupando
   `ETA · previsto` e `ATA · real`.
2. Colunas finais: `Chegada`, `ATD`, `BLs e CEs`, `Nº Escala`, `Vinculada`,
   `Ações`.
3. **`BLs e CEs` continua sendo o rótulo de status manual do usuário.** Não tem
   ligação com o estado real dos B/Ls e CEs — não colocar contagem nem medidor
   ali.
4. Remover o badge `deriv`. `ATD derivado` passa a ser só `ATD`.
5. Centralizar títulos de coluna **e** conteúdo das células.
6. **Atracações num painel recolhível com cabeçalho próprio de tom claro**
   (`Terminal · ETB · ATB · ETD · ATD · Restow`). A alternativa de linha-filha
   compartilhando as colunas da escala foi explicitamente rejeitada: confunde o
   leitor sobre a qual cabeçalho cada célula pertence.

---

## Bloco 2 — Aba Importação

**Arquivo:** `src/components/voyages/VoyageImportacaoTab.tsx`
**Artboards:** `ImportacaoAntes.dc.html` → `ImportacaoDepois.dc.html`

1. Estrutura por escala/POD.
2. Dentro de cada escala: painéis `Containers` e `Carga solta` lado a lado;
   `Veículos` e `Vazios IMP` como faixas da própria escala, com estado vazio
   tracejado quando não houve operação.
3. Cards de container ganham detalhe: tipos com contagem, IMO, OOG. Veículos
   ganham marca, tipo de container e unidades.
4. **Barra de ações única, com separadores:**
   `Baplie EDI │ B/L container · B/L carga solta · CE Mercante │ Veículos · Vazios IMP`
5. **Um botão só de CE Mercante serve container e carga solta.** `bls` é uma
   tabela só, com coluna `cargo_mode`; `CeMercanteImportTarget` (`src/services/ceMercanteImport.ts`) é
   `'bls' | 'granite'`, e o target `'bls'` casa por número de B/L, cobrindo os
   dois modos. O target `granite` é o único separado, e vive na Exportação.
6. A separação por manifestos foi removida do desenho — o sistema não os usa
   mais nesse ponto.
7. B/L de container abre modal idêntico ao da tela de B/Ls container. B/L de
   carga solta precisa de modal de importação atualizado.

---

## Bloco 3 — Aba Exportação

**Arquivo:** `src/components/voyages/VoyageExportacaoTab.tsx`
**Artboards:** `ExportacaoAntes.dc.html` → `ExportacaoDepois.dc.html`,
`ExportacaoMultiDepot.dc.html`, `ModalGranito.dc.html`

1. Blocos por terminal de embarque, cada um com painéis `Vazios EXP` e
   `Granito`.
2. **Aproveitar o que já é calculado e jogado fora:** `summarizeExportByPol`
   (`src/services/voyageSummaries.ts`) computa granito e vazios por POL, e
   `VoyageExportacaoTab` usa só `.length`.
3. **Barra de ações:**
   `Manifesto Granito · CE Mercante (Granito) │ Novo embarque de vazios`
4. **Vazios EXP não tem importação rápida.** O botão navega para a tela de
   Embarque de Vazios. Motivo: a RPC `import_vazios_bookings_transactional`
   (`src/services/vaziosImport.ts`) até faz
   `INSERT INTO vazios_export_operations`, mas só popula unidades — nunca
   `vazios_export_service_lines` — e pula a validação de seleção de porto. Criar
   o embarque pela tela é o caminho correto.
5. **Variante multi-depot** (`ExportacaoMultiDepot.dc.html`): `Vazios EXP` quebra
   em lista por depot — nome, código, tipos com contagem, unidades. Com um depot
   só, colapsa para uma linha. Usar `align-items: start` para o painel de
   Granito não esticar.
6. Modal "Importar Manifesto Granito": aplicar 0.4 (barra de preview escura).

---

## Bloco 4 — Aba Rotas e Manifestos

**Arquivo:** `src/components/voyages/VoyageManifestosTab.tsx`
**Artboards:** `RotasAntes.dc.html` → `RotasDepois.dc.html`

1. **Renomear a aba** de "Escalas & Manifestos" para **"Rotas e Manifestos"**.
2. Coluna 1 passa a se chamar **`Rota`**. **Remover a sub-linha de arquivo** —
   não existe mais vinculação de arquivo de manifesto.
3. **Remover o aviso de rota derivada dos B/Ls.**
4. Grupo de cabeçalho **`Mercante`** abrangendo duas colunas:
   **`CE Mercante · cobertura`** e **`Nº de manifesto Mercante`**.
5. O número faltante vira ação: onde hoje há o texto "manifesto não informado"
   em `#b45309` (fora dos tokens), com a instrução escondida no `title`, entra um
   chip **`Informar`** nos tokens dourados do app.
6. Larguras: o `table-fixed` atual dá 40% à rota e 12% a Ações; a rota com
   omissão (POL → POD riscado → POD de descarga, mais o selo) não cabe. Rota vai
   a **46%**, Ações encolhem para o botão.
7. **Faixa de totais no topo**, como nas outras abas: Rotas / B/Ls vinculados /
   CE Mercante / Nº de manifesto a informar. A faixa de conciliação sai —
   repetia o KPI que já está no herói da viagem.

---

## Bloco 5 — Aba ADR

**Arquivos:** `src/components/voyages/VoyageAgencyReportTab.tsx`,
`src/services/agencyDepartureReport.ts`
**Artboards:** `AdrAntes.dc.html` → `AdrDepois.dc.html`, mais
`AdrEstados.dc.html` com as hipóteses de estado (cada cartão cita a condição que
o produz no código).

Depende do Bloco 0.

### 5.1 Cabeçalho fica como está

**Não mexer** na fileira de escalas nem no painel `ADR por terminal`. Do painel
de departamentos sobra apenas a faixa de fechamento — contador, prazo,
`Imprimir`, `Fechar ADR` — porque os três cartões de assinatura descem para
dentro dos grupos (5.2).

### 5.2 Seções agrupadas por departamento, não por fase

`AGENCY_REPORT_SECTIONS` mapeia cada seção a um setor, e Equipamentos responde
por três (`veiculos`, `carga_carregada`, `vazios_embarcados`) hoje espalhadas
entre Importação e Exportação. Quem assina precisava caçá-las.

`ReportPhase` sai. Cada grupo de departamento traz:

- contador de seções resolvidas (`1/3 seções`) e barras de progresso;
- o estado de prazo do setor (`ADR 0039` — ATD + 3 dias úteis);
- o botão de assinar o setor, **esmaecido enquanto sobra seção pendente**;
- as reaberturas justificadas do setor, como linha própria.

A faixa de fechamento passa a nomear o setor que falta. Hoje isso só existe no
`title` do botão `Fechar ADR`, que apenas testa `signedDepartmentsCount !== 3`.

### 5.3 Carga descarregada — cada modo de carga com o próprio total

A seção é um 2×2: modo de carga (container / carga solta) × destino (final /
transbordo). O serviço já traz assim, em consultas separadas e disjuntas. A tela
achata metade disso.

- Remover o hero solto `148 containers descarregados` que flutua acima dos
  **dois** painéis mas só fala de container — carga solta se conta em B/L.
- Cada painel carrega o próprio total no topo: `145 unidades` e
  `5 B/Ls · 254 ton`.
- Renomear `Descarga de importação` → **`Containers descarregados`**.
- Os dois destinos ganham a mesma forma dos dois lados.

### 5.4 Containers com duas leituras

São duas perguntas diferentes, e hoje existe uma lista só:

- **`Por tipo`** — `20GP`, `40HC`, `40OT`, `40RH`. Quanto se movimentou de cada
  tipo.
- **`Por tipo e natureza`** — tabela `tipo × (carga geral / IMO / OOG)` com
  coluna `Total`. A coluna `Total` repete a leitura de cima.

O eixo de hoje mistura ordens diferentes: `transbordo` desce para uma linha
**`Destino`**; `veiculos` volta a ser `carga geral` aqui, com o detalhe na seção
Veículos.

### 5.5 O vazio passa a morar num lugar só

**Achado:** `agencyDepartureReport.ts:~1129` empurra todo container `empty` sem
B/L para a listagem de Carga descarregada (categoria `vazio`), e o **mesmo**
container já está dentro de `baplieEmptyCount` (~1140), que alimenta a
divergência de Vazios descarregados. É presença dupla.

- Carga descarregada passa a contar **só container cheio**.
- Vazios descarregados mostra as duas fontes lado a lado: contagem do Baplie
  contra classificados no módulo, mais quantos estão sem natureza.
- A divergência existente continua; agora ela tem onde aterrissar.

### 5.6 Avisos ganham forma

`DivergenceWarning`, `OrphanDataWarning` e `NadaOperado` eram `<p>` de 14px, com
o mesmo peso de qualquer parágrafo. Passam a ser:

- **divergência** — callout vermelho com ícone, prefixado por `Divergência`;
- **dado órfão** — callout dourado, prefixado por `Dado órfão`;
- **nada operado** — estado vazio tracejado;
- **observação** — bloco visível com barra lateral. Hoje só se descobre abrindo
  o editor.

### 5.7 Linha do tempo vira trilho

Eram sete marcos empilhados, cada um repetindo o mesmo par título/parágrafo.
Viram paradas lado a lado, com o estado do prazo dentro da parada e a reabertura
justificada pendurada embaixo de quem foi reaberto.

### 5.8 Hierarquia

`ReportPhase` era `<h2>` de 12px acima de blocos com `<h3>` de 16px. O selo do
departamento usava borda e texto verde sem fundo, fora do `.app-badge`. As
frentes de operação que compõem cada seção aparecem como pastilha ao lado do
título — são elas que decidem se há conteúdo naquele terminal.

### 5.9 O que **não** muda

- `resolvedReportId` continua sendo o terminal, e own / sign-offs / close /
  reopen / observação continuam amarrados a ele.
- O recorte por frente (`sectionIsVisible` + `terminalViewFor`) **não esconde** a
  seção sem frente no terminal: esvazia o conteúdo e mostra "Não há frente
  atribuída a este terminal". A seção continua exigindo resolução.
- A atribuição de frente é por **frente inteira**, não por unidade
  (`uq_voyage_escala_operation_front` é único em
  `(voyage_id, port, sentido, modalidade)`). O teto está declarado como
  `ponytail:` na migration `306`. Não tentar repartir por container neste
  trabalho.

---

## Bloco 6 — Página e cards (opcional, depois das abas)

**Artboards:** `Main.dc.html`, `Cards.dc.html`

1. A página gasta ~445px de altura antes de qualquer conteúdo de viagem — 115px
   de cabeçalho, 165px do painel de filtros, 165px do rail — e sem seleção o
   corpo é só um `EmptyState`.
2. Os quatro `DirectionKpiTile` (`src/components/voyages/VoyageCard.tsx`) empilham até oito pares label/valor a 12px, sem
   número dominante.
3. As abas do `VoyageCard` usam sublinhado próprio em vez do `.app-tab` (navy +
   risco dourado) que o resto do app usa.

---

## Encerramento

Quando o último bloco for mergeado, mover este arquivo para
`docs/archive/plans/` **na mesma mudança** e remover a linha correspondente de
`docs/plans/README.md`, conforme `docs/CONVENCOES.md`.
