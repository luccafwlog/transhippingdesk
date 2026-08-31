# Plano de Implementação: Revisão e Correção da Rolagem da Tela Line-up TV (Issue #582)

- **Status:** DONE
- **Data:** 2026-08-31
- **Origem:** Issue #582
- **Rotas afetadas:** /line-up-tv/display

## 1. Contexto e Diagnóstico

A tela de display do Line-up TV (/line-up-tv/display) exibe o quadro de escalas operacionais em tela cheia para visualização em TVs e monitores de parede do centro de operações. O display apresenta até 8 linhas visíveis simultaneamente (DISPLAY_VISIBLE_ROWS = 8). Quando o número de escalas registradas excede a capacidade visível, um carrossel automático translada suavemente as linhas para cima, permitindo a leitura contínua de todas as escalas. Em dispositivos touch/mobile (largura ≤ 1024px), o quadro é substituído por uma lista vertical de cartões (LineUpMobileCard) com rolagem nativa.

Diagnóstico dos problemas identificados:
1. **Ocultação da 9ª escala:** A condição hasAnimatedLoop = !isMobile && rows.length > DISPLAY_VISIBLE_ROWS + 1 impedia o loop quando havia exatamente 9 registros (9 > 8 + 1 é falso). A tela permanecia estática com overflow: hidden, deixando a 9ª linha permanentemente inacessível.
2. **Detecção de Touch/Mobile imprecisa:** O uso de 
avigator.maxTouchPoints > 0 fazia com que laptops ou monitores desktop com tela touch abrissem a visualização em cartões mobile em vez da tabela operacional TV em 1080p/4K.
3. **Contenção de overflow no desktop:** O shell usava min-height: 100vh, podendo causar barras de rolagem residuais do documento.
4. **Preservação e sincronismo:** Garantir sincronismo da transição de 3s, cálculo de altura dinâmica por ResizeObserver, preservação da posição do ciclo durante o polling periódico de 30s e destaque visual da cabeça do ciclo (pp-lineup-display-board__row--cycle-start).

## 2. Tarefas de Implementação

- [x] **T1. Ajustar lógica de rolagem e responsividade em `src/pages/LineUpTVDisplay.tsx`:**
  - Corrigir `hasAnimatedLoop` para `!isMobile && rows.length > DISPLAY_VISIBLE_ROWS`.
  - Implementar detecção responsiva reativa a resize para alternar entre desktop (> 1024px) e mobile (≤ 1024px).
  - Preservar `startIndex` durante background polling e reiniciar apenas em alteração real de `data.lastChangedAt` ou `rows.length`.
- [x] **T2. Ajustar contenção de viewport em `src/index.css`:**
  - Definir `height: 100vh; height: 100dvh; max-height: 100vh; max-height: 100dvh; overflow: hidden;` para `.app-lineup-display-shell` no desktop.
  - Assegurar `height: auto; min-height: 100svh; max-height: none; overflow: visible;` no breakpoint mobile (≤ 1024px).
- [x] **T3. Atualizar documentação viva em `docs/modules/operacao-suporte.md`:**
  - Atualizar referência de mais de nove linhas para mais de oito linhas.
- [x] **T4. Adicionar testes unitários e de integração em `src/pages/__tests__/LineUpTVDisplay.behavior.test.tsx`:**
  - Cobrir 5 escalas (placeholders), 8 escalas (estático), 9 escalas (loop ativo percorrendo todas as 9 linhas), N escalas, mobile cards e destaque de início de ciclo.
- [x] **T5. Validação e encerramento:**
  - Executar `npm test -- --run`, `npm run lint`, `npm run docs:check` e `npm run build`.
