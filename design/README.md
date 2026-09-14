# Redesenho da aba Disparo (Estudo exploratório)

Origem dos mockups do canvas de design publicados como exploração conceitual para a aba `/clientes/comunicacao?tab=disparo`.
São mockups estáticos de estudo visual para uma eventual evolução em duas colunas — não representam a implementação de produção (que manteve as etapas lineares com filtros compactados), e nada aqui entra no build.

## Artboards

| Arquivo | Estado retratado |
| --- | --- |
| `Main.dc.html` | Modo Carga com o modelo NOA — o caso mais comum |
| `Livre.dc.html` | Modo Carga com o modelo Livre e o editor de mensagem aberto |
| `Institucional.dc.html` | Modo Institucional |
| `Conferencia.dc.html` | Depois de conferir: composição colapsada, lista de destinatários |
| `AltBarraComando.dc.html` | Alternativa não escolhida — barra de comando no padrão de `/viagens` |
| `AltEtapas.dc.html` | Alternativa não escolhida — wizard por etapa |

`canvas.json` posiciona os artboards, separa proposta e alternativas em duas
páginas e carrega as notas do canvas.

## Sistema de design

Os valores foram extraídos de `src/index.css`, não aproximados: papel
`#f4f1ea`, superfície `#ffffff`, borda `#cdc8bc`, navy `#152238`, ouro
`#d4882e`, azul de ação `#1d4d88`; raio 8px, altura de controle 44px; Syne no
display, DM Sans no corpo, IBM Plex Mono nos números. Ao alterar um artboard,
puxe o valor do CSS de novo em vez de copiar daqui.

## Regerar e republicar

O `.html` publicado é gerado e está no `.gitignore`. Para atualizar o canvas,
edite os `.dc.html`, resemeie com o helper da skill `/design` e republique no
mesmo artifact.
