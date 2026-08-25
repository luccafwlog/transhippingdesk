# Design da página `/viagens` — três direções

Fontes do canvas de design publicado para escolher a estrutura da página
`/viagens`. Não é código de produção: nada aqui é importado por `src/`.

## Artboards

| Arquivo | Artboard |
| --- | --- |
| [`DirecaoA.dc.html`](./DirecaoA.dc.html) | Direção A · rail horizontal refinado (evolução do layout atual) |
| [`Main.dc.html`](./Main.dc.html) | Direção B · lista mestre + detalhe (candidata líder) |
| [`DirecaoC.dc.html`](./DirecaoC.dc.html) | Direção C · programação em tabela |
| [`DirecaoCDetalhe.dc.html`](./DirecaoCDetalhe.dc.html) | Direção C · `/viagens/:id` como página roteada |

[`canvas.json`](./canvas.json) posiciona os artboards e carrega as notas com a
motivação e o contrapeso de cada direção.

## Como os artboards são gerados

Os `.dc.html` são emitidos por [`build.mjs`](./build.mjs), que monta cada
artboard a partir de três módulos:

- [`kit.mjs`](./kit.mjs) — tokens e componentes transpostos 1:1 de
  `src/index.css` (tema `current`) e de `src/components/ui`: paleta, Syne/DM
  Sans/IBM Plex Mono, `.app-btn`, `.app-surface`, `.app-badge`, `.app-tab`,
  `.app-table`, além do cabeçalho, da faixa de câmbio e da barra de navegação.
- [`data.mjs`](./data.mjs) — dados de amostra. Nomes de navio, armador, portos
  e datas são plausíveis e seguem o vocabulário de
  [`CONTEXT.md`](../../CONTEXT.md) (inclusive o alias `ZYHY` e as marcas `OMIT`
  e `X` da programação), mas **não são registros reais**.
- [`blocks.mjs`](./blocks.mjs) — blocos compartilhados entre as direções:
  cabeçalho da página, barra de comando, herói da viagem, faixa de KPIs, abas,
  tabela de Planejamento por POD/POL, cards de módulo e linha do tempo.

```sh
node build.mjs
```

Para atualizar o canvas publicado, edite os módulos, rode `node build.mjs` e
gere de novo o arquivo do canvas com o helper do skill `design`
(`seed-canvas.mjs --template ... --artboard ... --canvas canvas.json`),
republicando no mesmo Artifact. O arquivo semeado é grande (~2 MB, embute o
editor) e por isso não é versionado.
