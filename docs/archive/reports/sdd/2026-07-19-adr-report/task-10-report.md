# Task 10 — Agregado do Agency Departure Report

## Entrega

- Criada `supabase/migrations/213_agency_departure_reports.sql`. Os números
  211 e 212 já pertencem ao hardening RBAC de Equipamentos, portanto a
  migration do agregado foi renumerada sem reutilizar histórico aplicado.
- Criadas as tabelas `agency_departure_reports`,
  `agency_departure_report_signoffs` e
  `agency_departure_report_occurrences`, ancoradas em `(voyage_id, port)`.
- RLS permite leitura a perfis internos ativos; escrita direta permanece sem
  policy e ocorre exclusivamente pelas RPCs `SECURITY DEFINER`.
- Implementadas RPCs para materializar o relatório, registrar sign-off,
  adicionar ocorrência append-only e alterar terminal. Elas normalizam porto,
  validam usuário/estado/seção e restringem cada ação ao departamento dono
  (ou Administrativo), inclusive para o papel Equipamentos.
- Atualizado `src/types/database.ts` com os tipos e tabelas do agregado e o
  plano vivo para referenciar a migration 213.

## Validação

- `npx vitest run src/services/__tests__/agencyReportMigration.test.ts` — 5
  testes passaram.
- `npm run lint` — passou.
- `npm run typecheck` — bloqueado por erros preexistentes na aba ADR:
  `src/components/voyages/__tests__/VoyageAgencyReportTab.test.tsx` e
  `src/services/agencyDepartureReport.ts` (relação Supabase de `vehicles` para
  `bl_containers`). Esta task não alterou esses arquivos.
