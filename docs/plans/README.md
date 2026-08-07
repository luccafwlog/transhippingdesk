# Planos de implementação (vivos)

Planos **ativos** — trabalho previsto e ainda não concluído. Este é o **único**
diretório de planos vivos do projeto; skills e agentes (incluindo o plugin
Superpowers) gravam planos novos aqui, nunca em outra pasta.

Quando um plano é totalmente executado, ele é movido para
[`../archive/plans/`](../archive/plans/README.md) como registro histórico —
no mesmo change que conclui a execução. A regra completa do ciclo de vida está
em [`../CONVENCOES.md`](../CONVENCOES.md#ciclo-de-vida-de-planos-e-specs).

O status atual do produto vive em [`../ROADMAP.md`](../ROADMAP.md).

## Planos ativos

| Plano | Tema | Status |
|---|---|---|
| [`2026-08-05-vehicles-desova.md`](./2026-08-05-vehicles-desova.md) | Veículos: local de desova e consolidação no ADR | TODO |
| [`2026-08-06-faturamento-ajuste-completo.md`](./2026-08-06-faturamento-ajuste-completo.md) | Faturamento: executar a ADR 0038 e consolidar as abas de `/faturamento` | TODO |

Valores de status: TODO · IN PROGRESS · DONE · BLOCKED (com motivo em uma linha).

## Ao concluir um plano

1. `git mv docs/plans/<plano>.md docs/archive/plans/`
2. Remover a linha da tabela acima.
3. Se a spec que originou o plano estiver em `docs/spec/`, movê-la para
   `docs/archive/specs/` e atualizar `docs/spec/README.md`.
4. Registrar a entrega no [`../CHANGELOG.md`](../CHANGELOG.md).
5. Rodar `npm run docs:check`.
