# Assets de marca

Três marcas convivem neste repositório e **não** compartilham assets. Trocar um
arquivo por outro coloca a marca errada na frente do público errado.

| Marca | O que é | Assets |
|---|---|---|
| **Vela** | O sistema interno, usado pela equipe | `vela-*` |
| **FWLog** | A empresa que atende o cliente (Portal) | `tr-logo.png` |
| **Transhipping** | A entidade jurídica e financeira | `transhipping-logo*.png` |

O cliente não deve ter visibilidade do nome Vela. Os assets `vela-*` são
arquivos novos: nenhum arquivo existente foi substituído, e `tr-logo.png` e
`transhipping-logo-cropped.png` continuam servindo fatura, recibo, Portal,
templates de e-mail e `CustomerSummaryReport` exatamente como antes.

## Arquivos Vela

| Arquivo | Uso |
|---|---|
| `vela-mark.svg` | Símbolo sobre fundo claro. Ao lado do nome, no lockup. |
| `vela-mark-dark.svg` | Símbolo sobre fundo escuro (topbar, tela de TV). |
| `vela-icon.svg` | Ícone com plaquinha, para 32px e acima. |
| `vela-icon-16.svg` | Ícone com plaquinha, geometria própria de 16px. |
| `vela-icon-{16,32,180,192,512}.png` | Rasterizações do ícone, para favicon e ícone de app. |

## Duas regras que não são preferência estética

**O ícone de 16px é um desenho diferente, não o de 32px reduzido.** O vão entre
as duas velas precisa cair em cima da grade de pixels; reduzido, ele fica pela
metade em dois pixels e o navegador borra os dois. Por isso `vela-icon-16.svg`
existe separado, com coordenadas inteiras numa `viewBox` de 16. O de 32 é
exatamente o dobro dele, então as duas versões nunca desalinham.

**O nome "Vela" não é imagem.** No app ele é texto HTML com
`font-family: var(--app-font-display)` (Syne, já carregado por `src/fonts.css`).
Assim ele herda tema, tamanho e acessibilidade, e não depende de um arquivo. Um
lockup em arquivo único só seria necessário para uso externo ou impressão — e
nesse caso a palavra precisa ser convertida em contorno antes, senão o arquivo
depende da fonte estar instalada em quem abrir.

## Paleta

Herdada de `src/index.css`, não inventada: navy `#152238`, topbar `#0e1825`,
ouro `#d4882e`, papel `#f4f1ea`. Na variante escura, `#eef2ff`, `#f59e0b` e
`#60a5fa`.
