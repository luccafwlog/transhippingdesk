# Revisão completa de UI/UX

- **Data:** 2026-08-19
- **Escopo:** sistema interno, Portal do Cliente, autenticação, Line-Up TV,
  modais e documentos imprimíveis.
- **Método:** código + runtime local com PostgreSQL descartável, shim Supabase,
  dados sintéticos e Playwright em 1440×900 e 390×844.
- **Cobertura runtime:** 31 superfícies no passe desktop (26 rotas internas e
  cinco rotas públicas do Portal), 25 rotas autenticadas no passe mobile e a
  inspeção interna do Portal com notificações reais sintéticas.
- **Artefatos de ambiente:** requests abortados durante troca deliberada de
  rota e websocket/realtime do shim não são defeitos do produto.

## Resultado

Nenhum P0 foi encontrado. Os problemas P1/P2 abaixo foram corrigidos nesta
revisão. O passe final não encontrou overflow horizontal nem erro de console
nas rotas navegadas; a matriz mobile também terminou sem documento mais largo
que a viewport.

## Antes e depois

| Antes | Depois | Por quê |
| --- | --- | --- |
| Notificações em painel fixo de 320 px, texto 12 px truncado em duas linhas, emojis e sem data | Painel de até 390 px, título 14 px, mensagem 13 px completa, ícones Lucide, data 12 px e estado lida/não lida explícito | Restaura legibilidade e confiança no evento comunicado ao cliente |
| Dropdown podia escapar lateralmente em 390 px | No mobile usa `position: fixed`, 12 px em cada borda e altura limitada ao viewport | Mantém todo conteúdo e rolagem acessíveis |
| Tokens `--app-link` e `--app-surface-hover` eram consumidos sem definição | Tokens definidos em current/light/dark | Links e feedback de hover deixam de cair em declaração CSS inválida |
| Sino, perfil, refresh PTAX, tabs e ações compactas tinham alvos de 11–36 px | Primitivas e variantes compactas têm alvo mínimo de 40×40 px | Melhora toque, mouse e acessibilidade motora em todas as páginas consumidoras |
| Portal sem skip link e sem alvo nomeado no conteúdo | Skip link aponta para `#portal-main-content` | Permite pular navegação repetida por teclado |
| Cabeçalho mobile espremia “Portal do cliente” em três linhas | Oculta empresa redundante, reduz “Sair” ao ícone e mantém marca em uma linha | Recupera hierarquia sem remover ações essenciais |
| Textos do Portal como “devolucao”, “Situacao” e “nao” | Cópia pt-BR acentuada nas superfícies revisadas | Remove ruído e aumenta percepção de qualidade |
| Relatório de Demurrage por consignatário não era permitido pela regra de impressão e podia sair vazio | Conteúdo recebeu classe própria, entrou na allowlist de impressão e os controles são ocultados no papel | Garante que o documento emitido contenha o relatório, não o chrome do modal |
| Animações e press states não tinham cobertura uniforme | Press state usa escala 0,96 e `prefers-reduced-motion` neutraliza movimento | Feedback tátil sem prejudicar usuários sensíveis a movimento |

## Priorização

| Prioridade | Eixo | Achado | Estado |
| --- | --- | --- | --- |
| P1 | Confiança | Notificações do Portal ilegíveis e truncadas | Corrigido |
| P1 | Conversão | Relatório por consignatário podia imprimir vazio | Corrigido |
| P2 | Entendimento | Cabeçalho do Portal quebrava a marca no mobile | Corrigido |
| P2 | Conversão | Alvos compactos abaixo de 40 px em Clientes, tarifas, tabs e header | Corrigido na primitiva compartilhada |
| P2 | Confiança | Tokens de link/hover ausentes | Corrigido nos três temas |
| P3 | Confiança | Acentuação inconsistente no Portal | Corrigido nas superfícies encontradas |

## Evidência de runtime

| Verificação | Resultado |
| --- | --- |
| Desktop 1440×900 | 31 superfícies, zero overflow sem tratamento, zero erro de console no passe final |
| Mobile 390×844 | 25 rotas autenticadas, zero overflow do documento, zero erro de console |
| Portal — notificações desktop | Painel 390 px dentro da viewport |
| Portal — notificações mobile | Painel 366 px, `x=12`, viewport 390 px |
| Portal — cabeçalho mobile | 390 px exatos, marca em uma linha e ações essenciais visíveis |
| Modal compartilhado | Foco dinâmico, Escape, focus trap e retorno ao disparador cobertos por teste |
| Impressão | Invoice, recibo e ADR preservados; relatório de consignatário adicionado ao contrato |
| Testes automatizados | 435 arquivos aprovados, 2.124 testes aprovados e 34 testes explicitamente ignorados |
| Gates de entrega | Typecheck, ESLint, `docs:check` e build de produção aprovados |

## Limites deliberados

Não foram alterados PIX, cálculo, RLS, migrations, exclusões ou semântica
financeira. O harness local exigiu concessões e colunas compatíveis com o shim;
isso foi aplicado apenas no banco descartável e não integra a mudança do produto.

## Nota editorial (2026-08-20)

A revisão de código da PR #565 encontrou que o relatório de Demurrage por
consignatário ("P1 — Conversão", marcado como "Corrigido" acima) continuava
imprimindo vazio: `Demurrage.tsx` renderiza `CustomerReportModal` como filho
direto de `.app-main` (sem wrapper de página), caso não coberto pela regra
`.app-main > *:not(:has(.app-modal-backdrop))`, que também ocultava o próprio
backdrop nesse cenário. A regra de impressão em `src/index.css` foi corrigida
para excluir `.app-modal-backdrop` da ocultação e mantê-lo visível quando é
filho direto de `.app-main`, com verificação automatizada acrescentada em
`InvoicePrintCssContract.test.ts`. O foco visível removido em
`.portal-notifications__item:focus-visible` e a duplicação de altura da faixa
de câmbio causada por `.app-market-refresh` (min-height 40px) também foram
corrigidos nessa mesma revisão. Este registro é histórico; o comportamento
atual está refletido no código e nos testes.
