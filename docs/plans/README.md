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

| Plano | Base de decisão | Status |
|-------|-----------------|--------|
| [2026-07-21-adr-signoff-departamental-ciclo](2026-07-21-adr-signoff-departamental-ciclo.md) | [ADR 0029](../adr/0029-adr-signoff-departamental-fases-ciclo.md) (supersede parcial 0027, estende 0028) | TODO |

Valores de status: TODO · IN PROGRESS · DONE · BLOCKED (com motivo em uma linha).

## Ao concluir um plano

1. `git mv docs/plans/<plano>.md docs/archive/plans/`
2. Remover a linha da tabela acima.
3. Se a spec que originou o plano estiver em `docs/spec/`, movê-la para
   `docs/archive/specs/` e atualizar `docs/spec/README.md`.
4. Registrar a entrega no [`../CHANGELOG.md`](../CHANGELOG.md).
5. Rodar `npm run docs:check`.
