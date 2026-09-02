-- 346: o status waiting é o padrão implícito do editor de escala.
-- A criação não deve gerar uma alteração de CE de NULL para waiting; estados
-- escolhidos pelo operador e alterações posteriores continuam auditáveis.
DO $patch_implicit_waiting_ce_audit$
DECLARE
  v_definition TEXT;
  v_patched_definition TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.save_voyage_escala_terminal_state(bigint,text,integer,jsonb,jsonb,jsonb,text)'::regprocedure
  ) INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'RPC save_voyage_escala_terminal_state não encontrada.';
  END IF;

  v_patched_definition := replace(
    v_definition,
    '        IF v_schedule_old_value IS DISTINCT FROM v_schedule_new_value THEN',
    $$        IF v_schedule_field = 'ces'
           AND v_schedule_old_value IS NULL
           AND v_schedule_new_value IN ('waiting', 'missing') THEN
          CONTINUE;
        END IF;
        IF v_schedule_old_value IS DISTINCT FROM v_schedule_new_value THEN$$
  );

  IF v_patched_definition = v_definition THEN
    RAISE EXCEPTION 'Não foi possível localizar o ponto de auditoria de ces na RPC legado.';
  END IF;

  EXECUTE v_patched_definition;
END;
$patch_implicit_waiting_ce_audit$;
