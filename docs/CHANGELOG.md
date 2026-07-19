# Changelog

> Histórico curado de entregas relevantes. Sintetizado dos planos de execução (arquivados em [archive/](archive/README.md)) e do histórico git. Não substitui o `git log`.

## 2026-07

- **Qualidade de código:** formatadores e `PreviewBox` consolidados; serviços de billing/timeline e páginas/abas de Clientes, Demurrage, Taxas Locais e Validação de Faturamento decompostos sem mudança de contrato, com testes comportamentais nos componentes-página. *(plan `2026-07-18-code-quality-audit-remediation`)*
- **Refinamento operacional (WS1–WS4):** ingestão documental de B/L com alias de navio (`canonicalizeVesselName`), ciclo completo de datas por escala com estado derivado (`deriveEscalaState`) no Painel/Line-Up TV, registro global de transbordo com timeline consolidada no Portal (migrations `201`–`202`), e câmbio PTAX/ROE com data efetiva (migration `200`). *(spec `refinamento-operacional-viagens-importacoes-lineup-portal`; plans `2026-07-16-ws1`–`ws4`)*
- **Portal:** fila de provisionamento autorrecuperável (migration `198_portal_provisioning_queue_self_heal`). *(spec/plan `2026-07-16-portal-fila-autorrecuperavel`)*
- **Docs:** reorganização de `docs/` — planos vivos só em `plans/`, specs vivas só em `spec/`, archive achatado (`plans/`, `specs/`, `audits/`, `reports/`); pastas `superpowers/` aposentadas. Ciclo de vida documentado em `CONVENCOES.md`.

## 2026-06

- **Portal:** login visível alterado para CNPJ + senha via Edge Function `portal-login`; o navegador não resolve nem recebe o email técnico. O fluxo anterior de CNPJ/CPF/email com `portal_resolve_login` fica registrado como comportamento superado.

- **Revisão/Portal/Faturamento:** correções pós-PRs 249–251: gate canônico aplicado em importação e faturamento, status/auditoria sob autoridade do banco, portal válido somente com `active + auth_user_id`, UI compatível com RLS e provisionamento em sequência segura. Sem backfill de B/Ls históricos faturados. *(ADR 0006; migration `20260619130000_review_gate_hardening`; specs/plans `2026-06-19-review-gate-pr249-251-corrections`)*
- **Faturamento:** auto-faturamento após correção de cliente na revisão; guarda de estado `invoiceable_ready`. *(specs/plans `2026-06-18-auto-faturamento-apos-revisao`)*
- **Clientes/Importação:** preservar o motivo de bloqueio de faturamento do cliente durante a importação (sem inferência genérica). *(`2026-06-18-preservar-bloqueio-cliente-importacao`)*
- **Viagens:** refactor master-detail com rota dedicada `/viagens/:voyageId`, barra de filtros no topo, rail colapsável, linha do tempo (auditoria + eventos de CE), CE Master por manifesto, exportação de Baplie EDI. *(ADR 0012; `2026-06-17-viagens-refactor`; `docs/archive/plans/0001-viagens-redesign`)*
- **Chegadas/Saídas:** nova tela de schedule de navios por porto (`vessel_schedules`).
- **Portal:** gate por CE Mercante — só expõe B/Ls com CE preenchido. *(`2026-06-15-portal-ce-mercante-gate`)*
- **Portal:** login por CNPJ ou email (`portal_resolve_login`), endurecimento da resolução de login, rate limiting. *(supera o email-only do ADR 0001)*
- **Portal:** área de operação read-only (B/Ls, containers, demurrage), redesign de UX/UI, dashboard, disputas e notificações in-app. *(`2026-06-09-portal-operacao-cliente`, `2026-06-15-portal-cliente-ux-ui`)*

## 2026-06 (início)

- **Pós-auditoria:** correções de segurança e financeiras (demurrage PIX, revogação de anon, default-deny em funções). *(`2026-06-09-correcoes-pos-auditoria`; ADR 0011)*
- **Exclusões:** exclusão controlada de B/Ls, containers, veículos e clientes com enforcement de bloqueio fiscal. *(`2026-06-09-exclusao-bls-containers-veiculos-clientes`; ADR 0009)*
- **Clientes:** melhorias de UX na tabela (ações compactas, filtro, ordenação). *(`2026-06-11-clientes-ux-melhorias`)*
- **Ajustes operacionais/financeiros:** reconciliação Baplie e regras de cliente. *(`2026-06-01-ajustes-operacionais-financeiros`)*

## Manutenção (sprint 2026-06-15)

- Upgrade do toolchain Vite e dependências (fechamento de advisories).
- Endurecimento da resolução de login do portal (rate limit anti-enumeração).
- Correção do filtro de devolvidos na operação do portal.
- Export CSV do billing do portal respeitando filtros ativos.
- Alertas de vencimento do dashboard por dias de calendário.

> Planos e specs completos em [archive/plans/](archive/plans/) e [archive/specs/](archive/specs/).
