# Redesenho da página `/viagens`

**Status:** DONE (PRs #588, #591–#599)
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
- `src/services/agencyDepartureReport.ts:893` — select de `baplie_containers`

Adicionar `is_oog` aos dois e um campo `is_oog` em
`AgencyReportDischargeContainer`, ao lado do `is_imo` que já existe.

**Precedência entre as duas fontes:** seguir a regra já usada para `is_imo` na
linha 1087 — `baplie ? Boolean(baplie.is_oog) : Boolean(container.is_oog)`, o
Baplie mandando quando há linha correspondente. Atenção ao tipo: `is_oog` é
`boolean` NOT NULL em `bl_containers` e `boolean | null` em `baplie_containers`,
daí o `Boolean(...)`.

### 0.2 `MatrixCategory` ganha `oog`

Em `src/services/agencyDepartureReport.ts`:

- `MatrixCategory` (589) ganha `'oog'`
- `MATRIX_CATEGORY_LABELS` (613) ganha `oog: 'OOG'`
- `CATEGORY_PRIORITY` (1074) posiciona `oog`

**Os três acima não bastam** — nenhum deles atribui categoria a container
nenhum. A atribuição é o ternário da **linha 1088**, único ponto onde a
categoria nasce:

```ts
const category: MatrixCategory = isTransshipment ? 'transbordo'
  : vehicleContainerIds.has(container.id) ? 'veiculos'
  : isImo ? 'imo' : 'carga_geral'
```

Sem um ramo `isOog` aqui, `'oog'` entra no tipo, no rótulo e na prioridade e a
coluna OOG sai **zerada**. O ramo entra antes de `isImo`, conforme a regra
abaixo.

**E o merge de duplicatas (linha 1103).** O laço agrega por `container_number`
antes de classificar; entre duplicatas ele faz `existing.is_imo = existing.is_imo
|| isImo` (linha 1101). `is_oog` precisa da **mesma linha** — sem ela, um
container OOG declarado em um B/L perde a marca porque outro B/L do mesmo
container não a declarou. A resolução de `category` entre duplicatas já é
coberta pelo `CATEGORY_PRIORITY` da linha 1103, que passa a conhecer `oog`.

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
2. Colunas finais: `Escala`, `Opera`, `Chegada` (agrupando `ETA` e `ATA`),
   `ATD`, `BLs e CEs`, `Nº Escala`, `Vinculada`, `Ações`. **`Escala` e `Opera`
   continuam**, como primeiras colunas com `rowspan={2}` — o artboard as mantém.
   As colunas de hoje são `Escala · Opera · ETA · ATA · ATD derivado · BLs e CEs
   · Nº Escala · VINCULADA · Ações` (`VoyageVisaoTab.tsx:229-237`): o que muda é
   `ETA`/`ATA` virarem sub-colunas de `Chegada`, `ATD derivado` virar `ATD` e
   `VINCULADA` perder o caixa-alta.
3. **`BLs e CEs` continua sendo o rótulo de status manual do usuário.** Não tem
   ligação com o estado real dos B/Ls e CEs — não colocar contagem nem medidor
   ali.
4. Remover o badge `deriv`. `ATD derivado` passa a ser só `ATD`.
5. Centralizar títulos de coluna **e** conteúdo das células.
6. **Atracações num painel recolhível com cabeçalho próprio de tom claro**
   (`Terminal · ETB · ATB · ETD · ATD · Restow`). A alternativa de linha-filha
   compartilhando as colunas da escala foi explicitamente rejeitada: confunde o
   leitor sobre a qual cabeçalho cada célula pertence.
7. **O painel deixa de ser somente leitura.** Hoje a linha-filha
   (`VoyageVisaoTab.tsx:306-318`) só renderiza `<span>`s — não há como criar nem
   editar atracação a partir da Visão geral; a edição só existe dentro do modal
   de escala. O artboard introduz duas ações que **não têm equivalente hoje** e
   precisam ser construídas:
   - **`Adicionar atracação`** no cabeçalho do painel;
   - **lápis por linha de atracação** (a sétima coluna, sem rótulo).

   Ambas caem em `src/components/shared/VoyageScheduleModals.tsx`, que já é dono
   da lista de atracações da escala (`atracacoesDoModal`) e de onde sai o
   `derivedTerminalAtd` (linhas 546-556). Decidir aí se as duas ações abrem o
   modal de escala já posicionado na atracação ou um modal próprio de atracação —
   **é a única pergunta em aberto do Bloco 1**, e ela não bloqueia os itens 1-6.

---

## Bloco 2 — Aba Importação

**Arquivos:** `src/components/voyages/VoyageImportacaoTab.tsx`,
`src/components/shared/VoyageImportActions.tsx`
**Artboards:** `ImportacaoAntes.dc.html` → `ImportacaoDepois.dc.html`

1. Estrutura por escala/POD.
2. Dentro de cada escala: painéis `Containers` e `Carga solta` lado a lado;
   `Veículos` e `Vazios IMP` como faixas da própria escala, com estado vazio
   tracejado quando não houve operação.
3. Cards de container ganham detalhe: tipos com contagem, IMO, OOG. Veículos
   ganham marca, tipo de container e unidades.
4. **Barra de ações única, com separadores:**
   `Baplie EDI │ B/L container · B/L carga solta · CE Mercante │ Veículos · Vazios IMP`

   Essa barra **não vive na aba**: os botões são de
   `src/components/shared/VoyageImportActions.tsx`, que a aba invoca com
   `types={[...]}`. Rótulo, ordem, gating de permissão e modais estão todos lá:
   `IMPORT_LABELS` (linha 22), `IMPORT_ORDER` (linha 33) e o filtro de permissão
   (linha 52). Duas consequências para este bloco:
   - a ordem pedida vem de `IMPORT_ORDER`, hoje
     `['baplie', 'blFreight', 'ceMercante', 'bb', 'vehicles', 'vaziosImp', 'granite', 'vaziosExp']`
     — os separadores do desenho precisam de agrupamento explícito, que o
     componente ainda não tem;
   - **`B/L container` e `B/L carga solta` são um botão só hoje** (`blFreight`,
     rotulado `B/L`). O desenho pede dois, porque abrem modais diferentes (item
     7) — isso é um `ImportType` novo, não uma mudança de rótulo.

   O componente é compartilhado com a Exportação (Bloco 3.4). Quem executar
   primeiro faz o agrupamento; o segundo só acrescenta seus tipos.
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

**Arquivos:** `src/components/voyages/VoyageExportacaoTab.tsx`,
`src/components/shared/VoyageImportActions.tsx`,
`src/services/voyageSummaries.ts`, `src/hooks/useBls.ts`
**Artboards:** `ExportacaoAntes.dc.html` → `ExportacaoDepois.dc.html`,
`ExportacaoMultiDepot.dc.html`, `ModalGranito.dc.html`

> **Reescrito depois da revisão do PR.** A versão anterior deste bloco dizia que
> `summarizeExportByPol` já devolvia granito e vazios **por terminal de
> embarque**, e que a aba só jogava fora esse detalhe. A segunda afirmação é
> verdadeira; a primeira não é, e era a premissa de que dependiam os itens de
> bloco por terminal e de multi-depot. O que segue parte do dado real.

### 3.0 O eixo do desenho não existe no dado que chega à aba

`summarizeExportByPol` (`src/services/voyageSummaries.ts:1232`) agrupa os vazios
por **depot**, não por terminal de embarque:

- a chave do grupo é `canonicalPort(booking.local?.code)` (linhas 1242 e 1248);
- `local` é `local:depots(id, code, name, tipo)` na query (`useBls.ts:378`) —
  é o **depot**, e `canonicalPort` (normalização de porto) está sendo aplicada a
  um código de depot;
- o terminal de embarque mora em `vazios_export_operations.embark_port`, ligado
  ao booking por `vazios_bookings.operation_id` (NOT NULL), e **nada disso é
  selecionado** pela query da viagem.

Duas consequências:

1. **Blocos por terminal não saem de `summarizeExportByPol` como ela é hoje.**
   O campo chamado `pol` é o código do depot.
2. **`vazios.origins` nunca tem mais de um valor.** Ele é
   `summarizeUniqueValues(polBookings.map((b) => b.local?.name ?? b.local?.code))`
   (linha 1264) calculado sobre um grupo cuja chave saiu **do mesmo campo**. Com
   `code` e `name` 1:1 na tabela `depots`, o resultado é sempre um depot só.

O granito já é por porto de embarque (`granite_manifests.loading_port`), então
só o lado dos vazios está desalinhado.

**O multi-depot em si é real** — um `vazios_export_operations` (um `embark_port`)
recebe bookings de vários depots, e `vazios_export_service_lines` tem `local_id`
e `destino_id` por depot. O artboard `ExportacaoMultiDepot.dc.html` está certo; o
que estava errado era o caminho até o dado. Agrupando por `embark_port`, os
depots viram a lista de dentro de cada bloco e o artboard passa a ser
alcançável.

### 3.1 Trazer `embark_port` até a aba

Em `src/hooks/useBls.ts`, dentro de `vazios_manifests(... vazios_bookings(...))`
(linha 372), acrescentar a operação:

```
vazios_bookings(
  id, container_number, container_type, local_id, condition,
  operation_id,
  operation:vazios_export_operations(id, embark_port),
  local:depots(id, code, name, tipo)
)
```

`operation_id` é NOT NULL, então o join é total — nenhum booking fica sem
terminal. Propagar `operation` no tipo `VoyageVaziosManifest`
(`voyageSummaries.ts:117`).

**Uma ida a mais ao banco não é necessária.** A alternativa de um hook próprio da
aba foi descartada: criaria uma segunda fonte para os mesmos bookings.

### 3.2 `summarizeExportByPol` → `summarizeExportByEmbarkPort`

Renomear e mudar o eixo. A assinatura passa a ser:

```ts
{
  embarkPort: string
  granite: { manifests, bls, weightTon, readyForBilling, invoiced }  // inalterado
  vazios: {
    units, distinctContainers, types,
    depots: Array<{ code: string; name: string | null; units: number; types: string }>
  }
}
```

- eixo do grupo: `canonicalPort(manifest.loading_port)` (granito) ∪
  `canonicalPort(booking.operation?.embark_port)` (vazios);
- `origins: string` **sai**. No lugar entra `depots`, agregado por
  `booking.local_id` dentro do grupo — é a lista que o artboard multi-depot
  desenha (nome, código, tipos com contagem, unidades). Com um depot só,
  a aba colapsa a lista numa linha; quem decide isso é a tela, não o serviço.

**Chamadores:** `VoyageExportacaoTab.tsx:17` e `VoyageCard.tsx:157`. O card só
reduz `granite.bls` e `granite.weightTon` (linhas 162-163), somas independentes
do agrupamento — **nenhum KPI do card muda de valor.** `countDistinctContainerNumbers`
e `summarizeOccurrences` continuam servindo; só `summarizeUniqueValues` deixa de
ser usada aqui.

Deixar um teste do serviço cobrindo o caso que motivou a mudança: dois depots
distintos sob o mesmo `embark_port` devem produzir **um** bloco com
`depots.length === 2`.

### 3.3 A aba

1. Faixa de total da viagem no topo, como na Importação.
2. **Um bloco por terminal de embarque**, cada um com os painéis `Vazios EXP` e
   `Granito`. `align-items: start` para o painel de Granito não esticar junto
   com a lista de depots.
3. Dentro de `Vazios EXP`, a repartição por depot de 3.2; com um depot só,
   uma linha.
4. Hoje a aba usa `exportByPol` apenas como `exportByPol.length`, para decidir
   entre os dois painéis de totais e o estado vazio (linha 42) — todo o detalhe
   por grupo é calculado e descartado. É esse detalhe que passa a ser desenhado.

### 3.4 Barra de ações

`Manifesto Granito · CE Mercante (Granito) │ Novo embarque de vazios`

Os três botões vivem em `src/components/shared/VoyageImportActions.tsx`, que é
quem tem `IMPORT_LABELS` (linha 22), `IMPORT_ORDER` (linha 33) e o gating de
permissão (linha 52). A aba passa `types={['granite', 'vaziosExp']}` (linha 72).
Três mudanças **nesse arquivo**, não na aba:

- **`CE Mercante (Granito)` não existe aqui.** O tipo `ceMercante` abre
  `<CeMercanteImportModal>` **sem** `target` (linha 205), e o default é `'bls'`
  (`ceMercanteImport.ts:81`). O alvo `granite` só é passado em
  `src/pages/Granite.tsx:473`. Portanto: ou um `ImportType` novo
  (`ceMercanteGranite`) que passe `target="granite"`, ou `ceMercante` ganha o
  target como parâmetro. **Não é recurso novo** — é o atalho, com a viagem
  travada, para o que `/granito` já faz.
- **`Vazios Exp` hoje É upload avulso.** Ao contrário do que a versão anterior
  deste bloco dizia, o botão **não** navega para o Embarque: `activeType ===
  'vaziosExp'` abre um `FileImportModal` que chama `importVaziosManifest`
  (linhas 154-180). É esse ramo que sai.
- Rótulo `Vazios Exp` → `Novo embarque de vazios`, e o `onClick` passa a navegar
  para a tela de Embarque de Vazios com a viagem travada.

**Por que tirar o upload avulso:** a RPC `import_vazios_bookings_transactional`
(`src/services/vaziosImport.ts:219`) cria a `vazios_export_operations` a partir
do `embark_port` lido da planilha (`VoyageImportActions.tsx:162`), mas popula só
as unidades — **nunca `vazios_export_service_lines`** — e pula a escolha do porto
entre as escalas da viagem. Um embarque criado por ali nasce sem taxas de
serviço. A tela de Embarque faz as duas coisas.

### 3.5 Modal "Importar Manifesto Granito"

- Aplicar 0.4 (a barra de prévia do `FileImportModal` usa cores de tema escuro
  dentro de um modal claro).
- O parser devolve `vesselVoyage` (o navio/viagem declarado dentro da planilha) e
  `importGraniteManifest` devolve `pendingCount` (B/Ls que não casaram com
  cliente). O modal descarta os dois e mostra só B/Ls e Erros — dá para importar
  a planilha errada na viagem certa sem perceber. Ambos entram na prévia.

## Bloco 4 — Aba Rotas e Manifestos

**Arquivo:** `src/components/voyages/VoyageManifestosTab.tsx`
**Artboards:** `RotasAntes.dc.html` → `RotasDepois.dc.html`

1. **Renomear a aba** de "Escalas & Manifestos" para **"Rotas e Manifestos"**.
2. Coluna 1 passa a se chamar **`Rota`**. **Remover a sub-linha de arquivo** —
   não existe mais vinculação de arquivo de manifesto.
3. **Remover o aviso de rota derivada dos B/Ls.**

   Os itens 2 e 3 são **o mesmo dado, e ele não nasce na aba**: em
   `src/components/voyages/voyageCardHelpers.tsx:218`,
   `collectVoyageManifestBatchRows` faz

   ```ts
   filenames: group.filenames.length ? group.filenames : ['Rota derivada dos B/Ls']
   ```

   — o texto do aviso é um nome de arquivo sintético injetado na mesma lista que
   alimenta a sub-linha. Retirar só a renderização em `VoyageManifestosTab.tsx`
   deixa `filenames` como dado morto no helper. Remover o campo lá e ajustar o
   tipo de retorno, conferindo os demais consumidores de
   `collectVoyageManifestBatchRows` antes.
4. Grupo de cabeçalho **`Mercante`** abrangendo duas colunas:
   **`CE Mercante · cobertura`** e **`Nº de manifesto Mercante`**.
5. O número faltante vira ação: onde hoje há o texto "manifesto não informado"
   em `#b45309` (fora dos tokens, `VoyageManifestosTab.tsx:139`), com a instrução
   escondida no `title`, entra um chip **`Informar`** nos tokens dourados do app.
   O campo por trás é `row.ceMaster` (`ce_master` no banco) — o vocabulário desta
   sessão o exibe como **`Nº de manifesto Mercante`**, mas **não renomear a
   coluna do banco nem o campo do helper** neste trabalho: a mudança é de rótulo.
6. Larguras: o `colgroup` atual (`VoyageManifestosTab.tsx:83-90`) é
   `40% · 12% · 8% · 12% · 12% · 16%` — respectivamente Rota, ATD POL, B/Ls,
   CE Merc., **CE Master (12%)** e **Ações (16%)**. A rota com omissão
   (POL → POD riscado → POD de descarga, mais o selo) não cabe em 40%, e Ações
   é hoje a **segunda coluna mais larga** para três ícones. Novo alvo:
   Rota **46%**, Ações **10%**, e os 12% devolvidos ao grupo `Mercante` do item
   4, que passa a carregar cobertura e número.

   > O artboard `RotasAntes.dc.html` desenha `CE Master 16% · Ações 12%`
   > (`rotas.mjs:48`) — invertido em relação ao código. Corrigido nesta revisão;
   > o "antes" agora transcreve o `colgroup` real.
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

Os itens abaixo trazem o sintoma **e** a decisão tomada na sessão. Antes desta
revisão só os sintomas estavam aqui; as decisões viviam apenas na anotação
`brief` do canvas (`canvas.mjs:41-44`), que não sobrevive a uma sessão nova.

1. A página gasta ~445px de altura antes de qualquer conteúdo de viagem — 115px
   de cabeçalho, 165px do painel de filtros, 165px do rail — e sem seleção o
   corpo é só um `EmptyState`.
   **Decisão:** o painel de filtros de 165px vira uma **barra de comando de uma
   linha**, com a busca sempre visível e os filtros aplicados como **chips
   removíveis**.
2. Os quatro `DirectionKpiTile` (`src/components/voyages/VoyageCard.tsx`)
   empilham até oito pares label/valor a 12px, sem número dominante.
   **Decisão:** cada tile passa a ter **um número dominante em Syne** e no
   máximo **três linhas de apoio**.
3. As abas do `VoyageCard` usam sublinhado próprio em vez do `.app-tab` (navy +
   risco dourado) que o resto do app usa.
   **Decisão:** adotar o `.app-tab` do design system.
4. **Decisão (rail):** o card do rail ganha **rodapé ancorado na base** com
   `B/L · CNTR · CE`, e o estado de conciliação passa a ser por **ponto E
   rótulo** — não só cor. No hover, o lápis **ocupa o lugar** do rótulo de
   conciliação em vez de flutuar por cima; os dois disputam o mesmo canto
   (`Cards.dc.html`).

**Direção A, e por quê:** a exploração começou em três direções de layout. A
escolhida mantém o rail horizontal e o card de detalhe com abas que já existem —
**nenhuma rota nova**, `VoyageRail` e `VoyageCard` seguem no lugar. As direções
descartadas não foram versionadas.

---

## Encerramento

Quando o último bloco for mergeado, mover este arquivo para
`docs/archive/plans/` **na mesma mudança** e remover a linha correspondente de
`docs/plans/README.md`, conforme `docs/CONVENCOES.md`.
