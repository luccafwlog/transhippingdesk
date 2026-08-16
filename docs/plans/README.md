# Planos de implementação (vivos)

Planos ativos — trabalho previsto e ainda não concluído. Este é o único
diretório de planos vivos do projeto; skills e agentes gravam planos novos aqui.

Quando um plano é totalmente executado, ele é movido para
[`../archive/plans/`](../archive/plans/README.md) como registro histórico.

## Planos ativos

| Plano | Tema | Status |
|---|---|---|
| [`2026-08-13-correcao-regressao-inicializacao-login-navegacao.md`](./2026-08-13-correcao-regressao-inicializacao-login-navegacao.md) | Harness, cache do shell e checkpoints para diagnosticar a lentidão no acesso frio, login e primeira navegação | IN PROGRESS |
| [`2026-08-15-implementacao-bloco-521-clientes-portal-alertas.md`](./2026-08-15-implementacao-bloco-521-clientes-portal-alertas.md) | Implementação das pendências de clientes, Portal, faturamento dependente e Disputes de Demurrage | TODO |

Valores de status: TODO · IN PROGRESS · DONE · BLOCKED (com motivo em uma linha).

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
