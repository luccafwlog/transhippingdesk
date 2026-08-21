# Changelog

> Histórico curado de entregas relevantes. Sintetizado dos planos de execução (arquivados em [archive/](archive/README.md)) e do histórico git. Não substitui o `git log`.

## 2026-08
- **Bloco 6 — Transversal e Portal do Cliente (#525 / Épico #519):**
  Entrega das superfícies transversais de consumo de Alertas e Notificações Internas (`339_treatment_echo_and_transversal_surfaces.sql`):
  - **Eco de Tratamento:** evento `dismissed` em `alert_item_events` e fan-out de Notificação Interna com severidade normal entregue aos demais destinatários da ocorrência corrente (excluindo o autor da dispensa), sem falhas de roteamento espúrias e com idempotência garantida.
  - **Sino de Notificações Internas:** componente montado no cabeçalho do `AppLayout` com consulta e badge paginados/otimizados, baixa individual e em massa (`mark_all_internal_notifications_read`), identificação explícita de entregas por fallback administrativo e de Eco de Tratamento, sem efeitos colaterais sobre a fila coletiva.
  - **Fila `/alertas` completa:** catálogo integral de rótulos de tipos e entidades, filtro server-side por departamento integrado a query params, formulário de dispensa com validação de motivo e data de revisão futura, e projeção de motivo, autor e data de revisão na linha dos itens dispensados.
  - **Resumo de Pendências por Setor no `/painel`:** agregação dedicada do banco sem o teto de 200 linhas da fila, cartões com pendências ativas e dispensadas separadas por departamento, e atalhos diretos pré-filtrados para a fila `/alertas`.
  - **Observabilidade de Falhas de Roteamento:** aba dedicada em `/admin/usuarios` listando ocorrências de `alert_notification_failures`, transparência sobre a audiência dos papéis do catálogo e preservação das fronteiras de segurança (sem atribuição individual).
  - **Contratos Negativos e Fronteira do Portal:** testes formais garantindo que `/perfil`, `/line-up-tv/display` e `/login` não disparam alertas operacionais internos e que o escopo do Portal do Cliente (`portalScope.ts`) não alcança RPCs nem tabelas internas.
- **PR #576 — correções da revisão independente da integração:** o fan-out de
  notificações agora respeita a união de `audience_departments`; os
  reconciliadores de viagem são server-only; alertas terminalizados usam
  `depots.code` e alertas de exportação sem granularidade documental ficam no
  nível da escala. Avanços de marco geram nova ocorrência/notificação,
  mutações de escala têm reconciliação imediata, a Conciliação PIX é
  administrativa-only, Disputes só aparecem para Equipamentos e falhas
  best-effort passam pela telemetria compartilhada (`338_alerts_review_hardening.sql`).
- **PR de Integração Transversal — Épico de Alertas e Operação (#519, Blocos 520–524):**
  Unifica as implementações dos 5 blocos operacionais em uma sequência linear de migrações (`323` a `332`):
  - **Bloco 1 (#520 — B/L e Revisão Manual):** Ciclo de vida e reconciliação de pendências de B/L e Granito (`324_review_bl_alerts_lifecycle.sql`), painel de contexto de revisão e bloqueio de faturamento de B/L pendente.
  - **Bloco 2 (#521 — Clientes, Portal e Disputes):** Modelo auditável de conversas de disputas de Demurrage (`demurrage_disputes`), triggers de gating de faturamento do portal (`portal_billing_gate`, `325_clientes_portal_disputes_alerts.sql`) e reprocessamento pós-ativação.
  - **Bloco 3 (#522 — Financeiro e Reconciliação PIX):** Persistência de pendências PIX (`pix_reconciliation_exceptions`, `328`), detector server-only otimizado de faturas vencidas (`329`), guards de status financeiro de Granito (`330`), resolução autoritativa de PIX (`331`) e sincronização condicional de alertas de disputas por respondente (`327`).
  - **Bloco 4 (#523 — Operação e Viagem):** Detectores e reconciliação de B/L esperado, Baplie ausente e cobertura documental, CE Mercante, datas de escala/terminal e exportação pós-ATD (`326_voyage_operation_alerts.sql`).
  - **Bloco 5 (#524 — Alertas do ADR):** Fundação de alertas por departamento para o Relatório de Agência, prazos de saída e deep links preservando escala, terminal e report (`323_agency_report_alerts_foundation.sql`).
  - **Runner Consolidado (`332_unified_alerts_runner.sql`):** Orquestrador server-only `public.run_alert_detectors()` executando todos os detectores do sistema com permissões e auditoria estritas.
- **PR #569 — revisão manual orientada a cliente (#562):** a fila passou a
  separar grupos por identidade documental segura, exibir evidências brutas do
  consignatário/carga e bloquear vínculos quando há CNPJs conflitantes. O novo
  onboarding transacional cria/resolve cliente, cadastra e-mail de forma
  idempotente, vincula todos os B/Ls do grupo e preserva somente exceções
  específicas. O convite do Portal é opcional e é enviado para o mesmo e-mail
  informado, enquanto o ciclo de vida permanece no Console de Provisionamento.
- **Fundação de Alertas e Notificações:** migrations `317`–`320` centralizam
  catálogo de severidade/audiência, agregado por entidade, itens com histórico,
  dispensa temporária auditável, fan-out de notificações internas por usuário e
  fallback crítico para Administrativo/Admin. Os detectores existentes passam a
  rodar server-side a cada 15 minutos pela Edge Function `alerts-detector`;
  `/alertas` consulta a fila sem detectar, reconhecer ou fechar manualmente e
  mantém alertas legados visíveis durante a migração dos produtores. O tipo ADR
  obsoleto `agency_report_section_pending` foi encerrado e o dead code
  `needsCeMercante` removido. *(plano `2026-08-11-alertas-e-notificacoes`;
  issue #519)*
