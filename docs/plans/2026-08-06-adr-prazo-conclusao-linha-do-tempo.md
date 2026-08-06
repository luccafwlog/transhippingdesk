# Prazo de Conclusão do ADR: linha do tempo e medição por departamento

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Executar a ADR 0039 — linha do tempo de assinaturas na aba ADR, prazo
de três dias úteis contado do ATD real, alerta de vencimento e agregado por
departamento em `/admin/usuarios`.

**Architecture:** A linha do tempo é exibição derivada (ADR 0027): lê o ATD da
escala unificada (`voyageRouteSchedules.ts`, precedência POD→POL da ADR 0035), os
`signed_at` já existentes e o histórico de reaberturas em `audit_logs`. O único
cálculo novo — vencimento em dias úteis — é função pura, compartilhada entre a
tela, o alerta e o agregado, para que as três superfícies nunca discordem.

**Tech Stack:** React, TanStack Query, Supabase RPC/migrations, Vitest.

---

### Task 1: Regra de prazo como função pura

**Files:** `src/services/agencyReportDeadline.ts` (novo), teste correspondente.

- [ ] Calcular o vencimento a partir de uma data de ATD (`YYYY-MM-DD`): três dias
      úteis, seg–sex, feriados contam, dia do ATD não conta.
- [ ] Derivar o estado por departamento — sem prazo (ATD ausente ou escala
      omitida), no prazo, vencido — a partir do ATD e do `signed_at` vigente.
- [ ] Cobrir as bordas discutidas: ATD de sexta e de sábado, assinatura anterior
      ao ATD, ATD lançado depois do vencimento (ADR nascido vencido).

### Task 2: Linha do tempo na aba ADR

**Files:** `src/components/voyages/AgencyReportTimeline.tsx` (novo),
`src/components/voyages/VoyageAgencyReportTab.tsx`,
`src/services/agencyDepartureReport.ts`, testes.

- [ ] Exibir os marcos: saída do navio (ATD) com o momento do seu registro,
      vencimento, as três assinaturas departamentais (data, hora e assinante) e o
      Fechamento sem semáforo próprio.
- [ ] Exibir reaberturas de assinatura com a justificativa, lidas de
      `audit_logs` (`agency_departure_report_department_signoff`).
- [ ] Tratar ausência de prazo: "aguardando a saída do navio" e escala omitida,
      ambos sem cor.

### Task 3: Marca de vigência e alerta de vencimento

**Files:** migration sequencial nova, `src/services/alerts.ts`,
`src/pages/Alertas.tsx`, testes de migration.

- [ ] Gravar a vigência do compromisso em `agency_report_pending_baselines`
      (mesmo mecanismo das migrations `214`/`251`); ATD anterior não é medido.
- [ ] Criar `detect_agency_report_deadline_missed()`: um alerta por departamento
      vencido sem assinatura, deduplicado por `(viagem, porto, departamento)`,
      sem substituir `agency_report_section_pending`.
- [ ] Fechar os alertas de vencimento junto com o Fechamento do ADR, como
      `close_agency_departure_report` já faz com os de pendência.

### Task 4: Snapshot e impresso

**Files:** `src/components/voyages/VoyageAgencyReportTab.tsx`,
`src/components/voyages/AgencyReportDocument.tsx`, testes.

- [ ] Incluir os marcos no `closed_snapshot` no fechamento.
- [ ] Imprimir apenas as datas de assinatura; nenhum veredito de prazo, cor ou
      contagem de dias no documento.

### Task 5: Agregado em Administração

**Files:** `src/pages/AdminUsuarios.tsx`, `src/services/agencyReportSla.ts`
(novo), hook e testes correspondentes.

- [ ] Listar uma linha por (viagem, porto) no período: ATD, assinatura de cada
      departamento, dias úteis até cada uma, cumpriu/não cumpriu e tempo total
      decorrido até o Fechamento.
- [ ] Somar a taxa de cumprimento **por departamento**, nunca por usuário.
- [ ] Excluir do agregado escalas omitidas e ATDs anteriores à vigência.

### Task 6: Gates e publicação

- [ ] Rodar testes focados, `npm run typecheck`, lint dos arquivos alterados,
      `npm run docs:check`, `npm test`, `npm run build` e `git diff --check`.
- [ ] Atualizar `docs/ARCHITECTURE.md` e `docs/RASTREABILIDADE.md` com a nova
      superfície e a RPC de detecção.
- [ ] Mover este plano para `docs/archive/plans/` e remover a linha de
      `docs/plans/README.md` no mesmo change que conclui a execução.
