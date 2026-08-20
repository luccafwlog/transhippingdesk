# Revisão completa de UI/UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir e verificar integralmente as superfícies visuais e interativas do sistema interno, Portal do Cliente e documentos imprimíveis.

**Architecture:** A implementação começa pelo design system compartilhado e pelas primitivas, porque seus efeitos alcançam todas as rotas. Depois corrige Portal, páginas e impressão, sempre sem alterar semântica de dados; por fim executa uma matriz automatizada de runtime e os gates do repositório.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, CSS, Lucide, Vitest, Testing Library e Playwright.

---

### Task 1: Baseline visual e matriz de cobertura

**Files:**
- Create: `scripts/design-audit/audit-ui.mjs`
- Create: `docs/archive/audits/2026-08-19-revisao-completa-ui-ux.md`

- [ ] Registrar as rotas de `src/App.tsx`, viewports e interações obrigatórias.
- [ ] Capturar desktop e mobile, console, falhas de request, overflow e alvos menores que 40 px.
- [ ] Classificar cada achado em P0–P3 e nos eixos Entendimento, Confiança e Conversão.
- [ ] Executar `node scripts/design-audit/audit-ui.mjs --baseline` e confirmar que o relatório contém todas as rotas ativas.
- [ ] Commit: `docs: registra baseline completo de UI e UX`.

### Task 2: Tokens e primitivas compartilhadas

**Files:**
- Modify: `src/index.css`
- Modify: `src/components/ui/Button.tsx`
- Modify: `src/components/ui/Modal.tsx`
- Test: `src/components/ui/__tests__/Modal.test.tsx`

- [ ] Escrever testes que exigem retorno de foco, foco dinâmico e fechamento por Escape.
- [ ] Rodar `npx vitest run src/components/ui/__tests__/Modal.test.tsx` e confirmar falha antes da correção.
- [ ] Completar tokens ausentes de link/hover/foco, tipografia, áreas mínimas, press state e `prefers-reduced-motion`.
- [ ] Corrigir a primitiva Modal para viewport, scroll interno e contrato de foco.
- [ ] Reexecutar o teste focado e confirmar aprovação.
- [ ] Commit: `fix: fortalece primitivas visuais e interativas`.

### Task 3: Portal do Cliente e notificações

**Files:**
- Modify: `src/components/layout/PortalLayout.tsx`
- Modify: `src/components/portal/NotificationBell.tsx`
- Modify: `src/index.css`
- Test: `src/components/portal/__tests__/NotificationBell.behavior.test.tsx`
- Test: `src/components/layout/__tests__/PortalLayout.test.tsx`

- [ ] Escrever testes para semântica, teclado, estado de erro, indicador não lido e navegação no modo inspeção.
- [ ] Rodar os dois arquivos de teste e confirmar as falhas relevantes.
- [ ] Implementar painel responsivo e legível, ícones vetoriais, datas, estados e foco.
- [ ] Adicionar skip link/main target e áreas de toque no layout do Portal.
- [ ] Reexecutar os testes e capturar Portal em desktop/mobile.
- [ ] Commit: `fix: torna notificacoes e navegacao do Portal legiveis`.

### Task 4: Páginas, tabelas, rolagem e controles

**Files:**
- Modify: `src/index.css`
- Modify: somente páginas/componentes apontados pelo baseline de `scripts/design-audit/audit-ui.mjs`
- Test: testes de comportamento proprietários das páginas alteradas

- [ ] Corrigir controles menores que 40 px, tabs de 36 px, overflow invisível, cabeçalhos e estados ambíguos nas páginas apontadas.
- [ ] Preservar tabelas densas em desktop e adicionar scroll/hint ou cards em 390 px.
- [ ] Verificar modais e menus acionáveis de cada rota com Playwright.
- [ ] Rodar os testes focados de cada componente alterado.
- [ ] Commit: `fix: corrige fluxos visuais das paginas operacionais`.

### Task 5: Documentos e modo de impressão

**Files:**
- Modify: `src/index.css`
- Modify: `src/lib/printDocument.ts`
- Modify: documentos compartilhados somente quando o teste visual exigir
- Test: `src/lib/__tests__/printDocument.test.ts`
- Test: testes dos documentos alterados

- [ ] Escrever testes para título/filename, isolamento do documento e restauração após impressão.
- [ ] Validar invoice, recibo, Demurrage, relatório do cliente e ADR com mídia `print` A4.
- [ ] Corrigir margem, quebra de página, cabeçalhos repetidos e ocultação do chrome.
- [ ] Reexecutar testes focados e gerar PDFs/capturas de evidência.
- [ ] Commit: `fix: padroniza documentos e modo de impressao`.

### Task 6: Verificação final, relatório e PR

**Files:**
- Modify: `docs/archive/audits/2026-08-19-revisao-completa-ui-ux.md`
- Move: `docs/plans/2026-08-19-revisao-completa-ui-ux.md` para `docs/archive/plans/2026-08-19-revisao-completa-ui-ux.md`
- Move: `docs/spec/2026-08-19-revisao-completa-ui-ux-design.md` para `docs/archive/specs/2026-08-19-revisao-completa-ui-ux-design.md`
- Modify: `docs/plans/README.md` e `docs/spec/README.md` quando aplicável

- [ ] Rodar `node scripts/design-audit/audit-ui.mjs --verify` e exigir cobertura total sem regressão crítica.
- [ ] Rodar `npm run typecheck`, `npm run lint`, `npm test`, `npm run docs:check` e `npm run build`.
- [ ] Revisar o diff para garantir que alterações preexistentes de segurança/COD não foram incluídas nos commits desta revisão.
- [ ] Arquivar spec/plano concluídos conforme `docs/CONVENCOES.md`.
- [ ] Publicar branch `codex/ui-ux-audit-completa`, abrir PR com evidências Before/After e acompanhar o CI do commit publicado até concluir.
