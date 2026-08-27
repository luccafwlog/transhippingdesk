-- 355_reconcile_remote_migration_history.sql
-- Aligns the production migration identity with the numeric files in the repo.
--
-- Context: the production history contains version 169 under the name of the
-- voyage-route RLS migration, while the repository and staging branch reserve
-- version 169 for the demurrage uniqueness migration and version 170 for the
-- voyage-route RLS migration. The schema objects already exist; only the
-- historical name is repaired so branch rebases do not replay the wrong file.
-- Data impact: none.
-- Rollback: restore the previous name only if the migration source is reverted
-- together with the corresponding remote history repair.

DO $repair$
DECLARE
  v_existing_name TEXT;
BEGIN
  SELECT name
  INTO v_existing_name
  FROM supabase_migrations.schema_migrations
  WHERE version = '169';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expected migration version 169 is missing from remote history';
  END IF;

  IF v_existing_name = 'demurrage_invoice_unique_active' THEN
    RETURN;
  END IF;

  IF v_existing_name <> 'voyage_route_ce_master_rls_active' THEN
    RAISE EXCEPTION
      'Unexpected migration 169 name: %. Refusing to rewrite remote history',
      v_existing_name;
  END IF;

  UPDATE supabase_migrations.schema_migrations
  SET name = 'demurrage_invoice_unique_active'
  WHERE version = '169';
END
$repair$;
