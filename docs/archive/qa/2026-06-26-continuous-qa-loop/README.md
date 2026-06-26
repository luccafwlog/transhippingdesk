# Loop de QA contínua — snapshot (2026-06-26)

Registro congelado do loop de QA contínua executado em 2026-06-25/26 e mergeado
em `main` via PR #291. Este diretório é um **snapshot histórico**: não é mantido
vivo após o congelamento. A fonte de verdade corrente é o código executável e
[`../../../RASTREABILIDADE.md`](../../../RASTREABILIDADE.md).

## Conteúdo

- [`report.md`](./report.md) — relatório das 12 iterações (cobertura, defeitos,
  riscos, confiança).
- [`defects-log.md`](./defects-log.md) — registro de defeitos (DEF-001..003,
  HARD-001, A11Y-001/002) com repro, causa raiz e correção.
- [`feature-spreadsheet.csv`](./feature-spreadsheet.csv) — inventário de 45
  features / 38 rotas com user story, edge cases, test cases e status (snapshot).

## Resultado

6 defeitos corrigidos (1 financeiro de alta severidade), 0 críticos/altos em
aberto. Cobertura: suíte automatizada + runtime de browser (telas internas,
Portal do Cliente, imports) + matriz de RLS + hardening gate de integração local.
Resíduo restante: grants/RLS/jobs e Edge Functions do Supabase **de produção**,
fora do alcance do ambiente local (ADR 0011/0013).
