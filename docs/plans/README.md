# Planos de implementação (vivos)

Planos ativos — trabalho previsto e ainda não concluído. Este é o único
diretório de planos vivos do projeto; skills e agentes gravam planos novos aqui.

Quando um plano é totalmente executado, ele é movido para
[`../archive/plans/`](../archive/plans/README.md) como registro histórico.

## Planos ativos

| Plano | Tema | Status |
|---|---|---|
| [`2026-08-13-correcao-regressao-inicializacao-login-navegacao.md`](./2026-08-13-correcao-regressao-inicializacao-login-navegacao.md) | Harness, cache do shell e checkpoints para diagnosticar a lentidão no acesso frio, login e primeira navegação | IN PROGRESS |
| [`2026-08-15-implementacao-bloco-520-bl-revisao.md`](./2026-08-15-implementacao-bloco-520-bl-revisao.md) | Implementação de B/L, Revisão Manual, importações e projeções de pendências — Bloco #520 | TODO |

Valores de status: TODO · IN PROGRESS · DONE · BLOCKED (com motivo em uma linha).

O plano tem bloqueio parcial: a persistência da Notificação Interna bloqueia as
partes das Tasks 1, 3 e 7 que dependem do sino; as Tasks 2 e 6 podem avançar
independentemente.

## Ao concluir um plano

1. `git mv docs/plans/<plano>.md docs/archive/plans/`
2. Remover a linha da tabela acima.
3. Se a spec originária estiver em `docs/spec/`, movê-la para `docs/archive/specs/`.
4. Registrar a entrega no [`../CHANGELOG.md`](../CHANGELOG.md).
5. Rodar `npm run docs:check`.
