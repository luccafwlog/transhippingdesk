# Design da página `/viagens`

Fontes do canvas de design publicado para a página `/viagens`. Não é código de
produção: nada aqui é importado por `src/`.

A **Direção A** foi a escolhida — mantém o rail horizontal e o card de detalhe
com abas que já existem, mudando hierarquia e densidade. A Direção C fica
versionada apenas como registro da decisão.

O trabalho segue aba por aba. A primeira fechada é a **Visão geral**, no
recorte da tabela de Planejamento por escala e do bloco de Atracações.

## Páginas do canvas

| Página | Artboards |
| --- | --- |
| Página | [`Main.dc.html`](./Main.dc.html) — a Direção A inteira |
| Abas | [`AbaImportacao`](./AbaImportacao.dc.html), [`AbaExportacao`](./AbaExportacao.dc.html), [`AbaEscalas`](./AbaEscalas.dc.html), [`AbaAdr`](./AbaAdr.dc.html) — rascunhos, ainda não revisados |
| Cards | [`Cards.dc.html`](./Cards.dc.html) — anatomia e estados |
| Visão geral · Planejamento | [`PlanejamentoAntes`](./PlanejamentoAntes.dc.html), [`PlanejamentoOpcao1`](./PlanejamentoOpcao1.dc.html), [`PlanejamentoOpcao2`](./PlanejamentoOpcao2.dc.html) |
| Não escolhidas | [`DirecaoC`](./DirecaoC.dc.html), [`DirecaoCDetalhe`](./DirecaoCDetalhe.dc.html) |

[`canvas.json`](./canvas.json) — gerado por [`canvas.mjs`](./canvas.mjs) — define
posições, páginas, notas e a página de abertura.

## Como os artboards são gerados

```sh
node build.mjs && node canvas.mjs
```

[`build.mjs`](./build.mjs) emite os `.dc.html` e grava as alturas em
[`heights.json`](./heights.json), que [`canvas.mjs`](./canvas.mjs) usa para
posicionar as molduras sem sobreposição. Os módulos de apoio:

- [`kit.mjs`](./kit.mjs) — tokens e componentes transpostos 1:1 de
  `src/index.css` (tema `current`) e de `src/components/ui`: paleta,
  Syne/DM Sans/IBM Plex Mono, `.app-btn`, `.app-surface`, `.app-badge`,
  `.app-tab`, `.app-table`, além do cabeçalho, da faixa de câmbio e da barra de
  navegação.
- [`data.mjs`](./data.mjs) — dados de amostra. Nomes de navio, armador, portos e
  datas são plausíveis e seguem o vocabulário de
  [`CONTEXT.md`](../../CONTEXT.md) (inclusive o alias `ZYHY` e as marcas `OMIT` e
  `X` da programação), mas **não são registros reais**.
- [`blocks.mjs`](./blocks.mjs) — blocos da página: cabeçalho, barra de comando,
  herói da viagem, faixa de KPIs, abas, planejamento, transbordo e linha do tempo.
- [`tabs.mjs`](./tabs.mjs) — corpo de cada aba do `VoyageCard`.
- [`visaogeral.mjs`](./visaogeral.mjs) — a tabela de Planejamento por escala:
  o "hoje", transcrição fiel de `src/components/voyages/VoyageVisaoTab.tsx`, e
  duas opções em aberto para onde a atracação vive (painel recolhível próprio
  ou coluna Berço resumida).

## Publicação

O arquivo semeado do canvas (`viagens-tres-direcoes.html`) é grande — ~2 MB,
embute o editor — e por isso não é versionado. O nome do arquivo ficou do
primeiro seed e é mantido de propósito: trocá-lo criaria um Artifact novo em
outra URL. O título publicado é "Página de Viagens".

Para atualizar: rode os dois scripts acima e semeie de novo com o helper do
skill `design` (`seed-canvas.mjs --template ... --artboard ... --canvas
canvas.json`), republicando no mesmo Artifact.
