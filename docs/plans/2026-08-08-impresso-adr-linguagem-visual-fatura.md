# Impresso do ADR com a linguagem visual da Fatura Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar o corpo do impresso do ADR (`AgencyReportDocument.tsx`) com a linguagem visual das faturas (taxas locais e demurrage), consumindo o `InvoiceDocumentKit` + `invoiceFormat` em vez do CSS próprio `agency-report-document__*`.

**Architecture:** Mudança de apresentação apenas — CSS e marcação, sem tocar `SnapshotSchema`, RPCs ou dados. O snapshot do ADR fechado continua íntegro; nenhum campo novo é lido, nenhum cálculo muda.

**Tech Stack:** React, CSS (`src/index.css`), Vitest.

---

### Task 1: Fatos da escala viram tabela de metadados do kit

**Files:** `src/components/voyages/AgencyReportDocument.tsx`, `src/index.css`.

- [ ] Substituir o `dl.agency-report-document__facts` por tabela `labelCell`/`cell`, mantendo a ordem (armador, navio/viagem, porto, terminal, ATA/ATB/ATD, restow).
- [ ] Remover as regras `agency-report-document__facts` de `src/index.css`.

### Task 2: Tabelas de conteúdo no padrão da fatura

**Files:** `src/components/voyages/AgencyReportDocument.tsx`, `src/index.css`.

- [ ] Aplicar cabeçalho navy `#1A2744` com texto branco e zebra `#f9fafb` nas tabelas de conteúdo (carga solta, granito, matriz de descarga, vazios descarregados, container com veículo, embarque de vazios, linhas de serviço, anexo, storage).
- [ ] Alinhar seções ao separador padrão dos documentos do kit e remover o bloco `agency-report-document__*` de `src/index.css`.
- [ ] Preservar resolução de seção (estado/autor/data), observações e assinaturas departamentais com o mesmo vocabulário visual; sem bloco PIX nem pagamento.

### Task 3: Testes de contrato do impresso

**Files:** `src/components/voyages/__tests__/AgencyReportDocument.test.tsx`.

- [ ] Atualizar seletores/estrutura esperada para a nova marcação (tabelas `labelCell`/`cell`, header navy, zebra).
- [ ] Cobrir ao menos: fatos da escala, resolução de seção, observações e assinaturas departamentais.

### Task 4: Gates e publicação

- [ ] Rodar testes focados, `npm run typecheck`, lint dos arquivos alterados, `npm run docs:check`, `npm test`, `npm run build` e `git diff --check`.
- [ ] Commitar em `main` e fazer push para `origin/main`.
