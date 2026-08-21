# Planos de implementação (vivos)

Planos ativos — trabalho previsto e ainda não concluído. Este é o único
diretório de planos vivos do projeto; skills e agentes gravam planos novos aqui.

Quando um plano é totalmente executado, ele é movido para
[`../archive/plans/`](../archive/plans/README.md) como registro histórico.

## Planos ativos

| Plano | Tema | Status |
|---|---|---|
| [`2026-08-15-implementacao-bloco-520-bl-revisao.md`](./2026-08-15-implementacao-bloco-520-bl-revisao.md) | Implementação de B/L, Revisão Manual, importações e projeções de pendências — Bloco #520 | IN PROGRESS — entregue no banco (`324_review_bl_alerts_lifecycle.sql`) |
| [`2026-08-15-implementacao-bloco-521-clientes-portal-alertas.md`](./2026-08-15-implementacao-bloco-521-clientes-portal-alertas.md) | Implementação das pendências de clientes, Portal, faturamento dependente e Disputes de Demurrage | IN PROGRESS — entregue via PR #571 (`324_clientes_portal_disputes_alerts.sql`) |
| [`2026-08-16-implementacao-bloco-522-financeiro-alertas.md`](./2026-08-16-implementacao-bloco-522-financeiro-alertas.md) | Implementação do contrato de alertas, notificações e reconciliação PIX do Bloco 3 — Financeiro (#522) | IN PROGRESS — entregue via PR #573 |
| [`2026-08-16-bloco-4-operacao-viagem-alertas.md`](./2026-08-16-bloco-4-operacao-viagem-alertas.md) | Implementação dos alertas BL, Baplie, CE e exportação do Bloco 4 | IN PROGRESS — em desenvolvimento via PR #574 |
| [`2026-08-17-implementacao-bloco-524-adr-alertas.md`](./2026-08-17-implementacao-bloco-524-adr-alertas.md) | Implementação dos Alertas e Notificações Internas do Relatório de Agência (ADR) | IN PROGRESS — integrado via PR #570 (migration `323`) |
| [`2026-08-20-implementacao-bloco-525-transversal-portal.md`](./2026-08-20-implementacao-bloco-525-transversal-portal.md) | Implementação das superfícies transversais: sino interno, fila `/alertas`, resumo do `/painel`, falha de roteamento e Eco de Tratamento — Bloco #525 | BLOCKED — depende da integração dos produtores dos Blocos 1–5 (#519, §2, passo 11) |

Valores de status: TODO · IN PROGRESS · DONE · BLOCKED (com motivo em uma linha).

### Sincronização de 2026-08-20

O plano de 2026-08-11 foi ressincronizado com as decisões posteriores a ele —
ADR 0053 (ciclo de vida e dispensa temporária), ADR 0054 (Portal como gate) e as
cinco specs de bloco. Passou a ter um item **E4 — dispensa temporária** no Bloco
0, o catálogo completo de gravidade por evento no E1 e o mapa entre as letras do
catálogo (A–D) e as issues #520–#525.

> **Nota de sincronização de migrations (PRs #568, #569, #570, #571, #573, #574).**
> A fundação transversal E1–E4 foi totalmente implementada e mergeada em `main`
> pela PR #568 (migrations `317`–`321`). Na sequência:
> - PR #569 entregou o onboarding em lote de grupos de clientes (migration `322`).
> - PR #570 integrou os alertas de ADR / Relatório de Agência (migration `323`).
> - PR #571 implementou o Bloco 2 (#521 — Clientes, Portal e Disputes) via migration `324_clientes_portal_disputes_alerts.sql`.
> - PR #573 implementou o Bloco 3 (#522 — Financeiro e Reconciliação PIX).
> - PR #574 implementa o Bloco 4 (#523 — Operação e Viagem).
> - O Bloco 6 (#525) consome as superfícies transversais após a integração dos produtores.

### Nota editorial sobre o registro de decisões de #519

A regra de encerramento de #519 nomeia
`docs/plans/2026-08-11-alertas-e-notificacoes.md` como destino das decisões.
Para o Bloco #521, esse registro foi formalizado como spec funcional em
[`../spec/2026-08-15-clientes-portal-alertas-design.md`](../spec/2026-08-15-clientes-portal-alertas-design.md), que é a fonte canônica ligada ao
plano acima. A substituição é intencional: a spec separa decisões funcionais
do plano de execução e deve ser consultada pelos blocos seguintes até que um
registro transversal seja consolidado.

## Ao concluir um plano

1. `git mv docs/plans/<plano>.md docs/archive/plans/`
2. Remover a linha da tabela acima.
3. Se a spec originária estiver em `docs/spec/`, movê-la para `docs/archive/specs/`.
4. Registrar a entrega no [`../CHANGELOG.md`](../CHANGELOG.md).
5. Rodar `npm run docs:check`.
