# QA — Validação contínua

Artefatos da frente de qualidade e validação contínua (descoberta de features,
geração e execução de testes, defeitos e regressão).

- [`feature-spreadsheet.csv`](./feature-spreadsheet.csv) — planilha canônica
  (fonte única) de features: ID, user story, comportamento esperado, edge cases,
  test cases, status, defeitos, severidade e última data de teste.
- [`iteration-01-report.md`](./iteration-01-report.md) — relatório da iteração 1
  (cobertura, defeitos encontrados/corrigidos, riscos e confiança).
- [`defects-log.md`](./defects-log.md) — registro de defeitos com repro,
  resultado esperado/observado, severidade e hipótese de causa raiz.

Estes artefatos derivam de [`../RASTREABILIDADE.md`](../RASTREABILIDADE.md) e dos
módulos vivos em [`../modules/`](../modules/). A fonte de verdade do
comportamento continua sendo o código executável e os testes.
