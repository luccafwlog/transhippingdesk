# Auditoria de totais — `/viagens` e abas (2026-08-26)

Snapshot histórico. Varredura de todos os números exibidos em `/viagens`,
`/viagens/:voyageId` e nas cinco abas (Visão geral, Importação, Exportação,
Rotas e Manifestos, ADR), com foco na **fonte** de cada total e em **o que
deveria estar visível e não está**. Base: `main` em `fcb7f6d`.

## Superfícies inspecionadas

| Superfície | Números exibidos | Fonte |
| --- | --- | --- |
| Rail (`VoyageRail`) | `B/L · CNTR · CE`, estado de conciliação, contador `N viagens` | `buildVoyageRailItems` sobre o payload de `useVoyages` |
| Barra de comando (`VoyageFilters`) | `visíveis / total` | `filterVoyageRailItems` |
| KPIs do cartão (`VoyageCard`) | Importação, Exportação, Próxima escala, Conciliação Mercante | payload da viagem + `useVoyageVehicleStats` + `useViagemSchedulesAndStats` |
| Visão geral | planejamento por escala, atracações, timeline | projeção unificada de escalas |
| Importação | faixa de totais + blocos por POD | `summarizeImportByPod`, `useVoyageVehicleStats`, `useVaziosImportacaoStats` |
| Exportação | faixa de totais + blocos por porto de embarque | `summarizeExportByEmbarkPort` |
| Rotas e Manifestos | `Rotas`, `B/Ls vinculados`, `CE Mercante`, `Nº de manifesto a informar` | `collectVoyageManifestBatchRows` |
| ADR | carga descarregada, vazios, veículos, granito, embarque de vazios | `getAgencyReportDerivedData` (+ `closed_snapshot` quando fechado) |

## Corrigido nesta mudança

1. **KPI `CE Master` ignorava o CE Master do manifesto importado.**
   `VoyageCard` contava apenas as linhas de `voyage_route_ce_master`, enquanto a
   aba Rotas e Manifestos resolve o número por rota lendo `import_batches.ce_master`
   **e** `voyage_route_ce_master` (`collectVoyageManifestBatchRows`). Numa viagem
   cujo CE Master veio do arquivo, o KPI dizia `0/3` com a aba mostrando as três
   rotas preenchidas e `Nº de manifesto a informar: 0`. O KPI passa a derivar das
   mesmas linhas da aba (`ceMasterCount/ceMasterTotal` sobre `manifestRows`), o
   que também elimina a segunda normalização de porto (`POL__POD` cru) que
   convivia com a de `collectVoyageManifestBatchRows`.

2. **KPI `vazios embarcados` lia um agregado diferente do da aba.**
   O cartão somava `vazios_manifests.total_bookings` (contador gravado no
   manifesto) e a aba Exportação soma os bookings agrupados por `embark_port`.
   Com o agregado defasado, os dois números divergiam na mesma tela. O KPI passa
   a reusar `summarizeExportByEmbarkPort`, já calculado no cartão para Granito.

3. **Filtro de período invertido no rail.** `periodoMinEta` devolvia `hoje + N`
   e o predicado descartava `eta < min`: `Próx. 7 dias` escondia exatamente as
   escalas dos próximos 7 dias e mantinha todas as posteriores — inclusive no
   contador `visíveis / total`. Virou janela fechada `[hoje, hoje + N]`, com
   `Hoje` como janela de um dia. A conversão de data também deixou de passar por
   `toISOString` (UTC), que erra o dia a leste de Greenwich.

4. **ADR fechado/impresso perdeu o destino dos containers descarregados.**
   Depois que `is_transshipment` virou flag própria (natureza e destino como
   eixos independentes), `transbordo` deixou de ser categoria da matriz — e a
   matriz é tudo o que o snapshot guardava. A aba continuava mostrando
   `Destino final / Em transbordo`, mas o ADR fechado e o impresso não. O split
   passa a viajar em `sections.cargaDescarregada.destino` (mesma seção já
   liberada pela allowlist da migration `249`, sem migration nova) e é impresso
   como `Destino dos containers descarregados`. Snapshot fechado antes da
   separação não tem a chave e continua imprimindo o transbordo como categoria
   da própria matriz. O predicado virou função compartilhada
   (`isTransshipmentContainer`), que lê as duas formas.

## Achados registrados sem correção

1. **Estado de conciliação diverge entre rail e cartão.** `buildVoyageRailItems`
   chama `deriveEstadoConciliacao` com `hasOpenDivergences: false` fixo — a
   conciliação Baplie × B/L é por viagem e cara, e só roda no detalhe
   (`useVoyageReconciliation`). Uma viagem com divergências abertas aparece como
   **Conciliado** no rail e **Divergente** no KPI logo abaixo, com o mesmo
   rótulo e a mesma cor. É limitação assumida da lista, mas o rótulo não avisa:
   ou o rail passa a exibir só a cobertura de CE (que é o que ele de fato mede),
   ou um agregado barato de divergências por viagem precisa existir.

2. **`Granito · ton` tem duas fontes com o mesmo rótulo.** A aba Exportação usa
   o cabeçalho do manifesto (`granite_manifests.total_weight_kg`, peso
   declarado) e o ADR usa `granite_bls.real_weight_kg` (peso real por B/L). Os
   dois números são legítimos e vão divergir; nenhuma das telas diz qual está
   mostrando. Mesma observação para `B/Ls` (cabeçalho `total_bls` × contagem de
   linhas).

3. **`B/Ls vinculados` (Rotas e Manifestos) pode passar o KPI `B/Ls`.** Um batch
   sem nenhum B/L carregado no payload entra em
   `collectVoyageManifestBatchRows` somando `batch.total_bls` numa rota
   `- → -`. O KPI do cartão conta `voyage.bls.length`. Fica um total maior na
   aba do que no cabeçalho, e uma linha de rota sem porto.

4. **B/L sem POD aparece só na Importação.** `summarizeImportByPod` agrupa por
   `canonicalPort(bl.pod)`, que devolve `-` para POD vazio: a aba desenha um
   bloco de escala chamado `-`. `collectVoyagePorts` descarta o mesmo B/L, então
   ele não conta em `Planejadas` nem gera linha de planejamento. O bloco
   `Sem escala atribuída` existe para veículos e vazios, mas não para B/Ls.

5. **`BLs e CEs` (planejamento por escala) não é contagem.** A coluna exibe só o
   rótulo de status manual do POD — comportamento deliberado (ver plano
   arquivado `2026-08-26-redesenho-da-pagina-viagens.md`, item 3). O nome
   sugere um total que não existe; `VoyageCard` calcula `blCount` por escala e o
   usa apenas no modal de omissão. Renomear a coluna ou passar a contagem
   resolveria a ambiguidade.

## Verificação

`npm test` (2385 testes), `npm run lint`, `npm run build` e `npm run docs:check`
executados após as correções. Novos testes: janela do filtro de período
(`viagensFilters.test.ts`), fontes dos KPIs de CE Master e vazios embarcados
(`VoyageCard.kpis.test.tsx`) e destino impresso no ADR
(`AgencyReportDocument.test.tsx`).
