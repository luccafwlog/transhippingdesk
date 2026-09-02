-- RBAC: papel Equipamentos (spec ADR 2026-07-19; CONTEXT.md "Escopo de
-- Equipamentos" — escrita em VAZIOS EXP e Veiculos, sign-off das suas secoes).
-- Intent: o sign-off departamental do Agency Departure Report exige o papel;
--   a autoridade fina por secao fica nas RPCs da migration 211.
-- Rollback: reaplicar o constraint de 040 sem 'equipamentos' (apenas se nao
--   houver usuarios com o papel).

ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
    CHECK (role IN ('admin', 'operator', 'administrativo', 'financeiro', 'operacoes', 'documentacao', 'equipamentos'));
