-- 356_reconcile_atracacao_migration_history.sql
-- Aligns the production migration identity for the terminal-berthing schema.
--
-- Context: production recorded version 341 as alerts_rls_hardening, while the
-- repository and persistent staging branch reserve version 341 for
-- atracacao_datas_por_terminal. The alert hardening migration is already
-- correctly represented by version 343; only the historical name is repaired.
-- Data impact: none.
-- Rollback: restore the previous name only if the migration source is reverted
-- together with the corresponding remote history repair.

DO $repair$
DECLARE
  v_existing_name TEXT;
BEGIN
  -- Keep disposable local replays independent of Supabase's internal schema.
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RETURN;
  END IF;

  SELECT name
  INTO v_existing_name
  FROM supabase_migrations.schema_migrations
  WHERE version = '341';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expected migration version 341 is missing from remote history';
  END IF;

  IF v_existing_name = 'atracacao_datas_por_terminal' THEN
    RETURN;
  END IF;

  IF v_existing_name IS NULL
     OR v_existing_name <> 'alerts_rls_hardening' THEN
    RAISE EXCEPTION
      'Unexpected migration 341 name: %. Refusing to rewrite remote history',
      v_existing_name;
  END IF;

  UPDATE supabase_migrations.schema_migrations
  SET name = 'atracacao_datas_por_terminal'
  WHERE version = '341';
END
$repair$;
