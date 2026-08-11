# Planos de implementação (vivos)

Planos ativos — trabalho previsto e ainda não concluído. Este é o único
diretório de planos vivos do projeto; skills e agentes gravam planos novos aqui.

Quando um plano é totalmente executado, ele é movido para
[`../archive/plans/`](../archive/plans/README.md) como registro histórico.

## Planos ativos

| Plano | Tema | Status |
|---|---|---|
| [`2026-08-10-ce-mercante-granito.md`](./2026-08-10-ce-mercante-granito.md) | CE Mercante como confirmador do cálculo também no Granito | TODO |
| [`2026-08-10-correcoes-pr-512-fila-de-bloqueios.md`](./2026-08-10-correcoes-pr-512-fila-de-bloqueios.md) | Correções dos 14 achados da revisão da PR #512 | TODO |

Valores de status: TODO · IN PROGRESS · DONE · BLOCKED (com motivo em uma linha).

## Ao concluir um plano

1. `git mv docs/plans/<plano>.md docs/archive/plans/`
2. Remover a linha da tabela acima.
3. Se a spec originária estiver em `docs/spec/`, movê-la para `docs/archive/specs/`.
4. Registrar a entrega no [`../CHANGELOG.md`](../CHANGELOG.md).
5. Rodar `npm run docs:check`.
