# Task 5 report — alerta pós-ATD e escala unificada

## Status

Implementado sobre `eab8ea78`.

## Escopo entregue

- Criada `supabase/migrations/251_agency_report_pending_escala_unificada.sql`.
- `detect_agency_report_pending` agora considera ATD de `voyage_pod_schedule` e `voyage_pol_schedule`, apenas para portos `BR*`.
- O baseline da migration 214 (`2026-07-19 00:00:00+00`) foi preservado para POD; POL recebeu o novo baseline `2026-08-03 00:00:00+00`.
- O alerta continua agrupado por departamento (`operacoes`, `documentacao`, `equipamentos`) e mantém segurança, revoke/grant e deduplicação do contrato vigente.
- Não foram alterados migrations existentes, `src/types/database.ts`, `ladenOnBoardAtd.ts`, sign-off, fechamento nem `src/services/alerts.ts`.

## Evidência

- RED: `npx vitest run src/services/__tests__/escalaUnificadaMigration.test.ts --pool forks --maxWorkers 1` falhou por ausência da migration 251.
- GREEN: `npx vitest run src/services/__tests__/escalaUnificadaMigration.test.ts --pool forks --maxWorkers 1` — 10 testes passaram.
- `npm run lint` — passou.
- `git diff --check` — passou.

## Preocupações

- O baseline de POL é fixo na data desta entrega, seguindo o padrão hardcoded já usado pela migration 214; se a aplicação da migration for adiada, revisar se o corte precisa ser reconciliado antes do merge/deploy.
