# Task 5 report — alerta pós-ATD e escala unificada

## Status

Implementado sobre `eab8ea78`; round 1 corrigido sobre `a1bf7028`.

## Escopo entregue

- Criada `supabase/migrations/251_agency_report_pending_escala_unificada.sql`.
- `detect_agency_report_pending` agora considera ATD de `voyage_pod_schedule` e `voyage_pol_schedule`, apenas para portos `BR*`.
- O baseline da migration 214 (`2026-07-19 00:00:00+00`) foi preservado para POD; POL captura `clock_timestamp()` na aplicação da 251 em tabela interna server-only e lê esse corte no RPC.
- O alerta continua agrupado por departamento (`operacoes`, `documentacao`, `equipamentos`) e mantém segurança, revoke/grant e deduplicação do contrato vigente.
- Não foram alterados migrations existentes, `src/types/database.ts`, `ladenOnBoardAtd.ts`, sign-off, fechamento nem `src/services/alerts.ts`.

## Evidência

- RED da correção: o contrato atualizado falhou porque a função ainda usava a data literal de POL.
- GREEN: `npx vitest run src/services/__tests__/escalaUnificadaMigration.test.ts --pool forks --maxWorkers 1` — 10 testes passaram.
- `npm run lint` — passou.
- `git diff --check` — passou.

## Preocupações

- A captura de POL ocorre no momento da execução da migration; em caso de reexecução manual fora do fluxo normal, preservar a semântica de aplicação única das migrations antes de promover.
