-- Harden permissive RLS policies that remained from early BAPLIE/export modules.
--
-- Read access stays available to active internal users. Operational imports and
-- reconciliation updates stay available to active users. Destructive deletes
-- require admin privileges.

-- baplie_reconciliation_resolutions -----------------------------------------
ALTER TABLE public.baplie_reconciliation_resolutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read baplie_reconciliation_resolutions"
  ON public.baplie_reconciliation_resolutions;
DROP POLICY IF EXISTS "Authenticated users can insert baplie_reconciliation_resolutions"
  ON public.baplie_reconciliation_resolutions;
DROP POLICY IF EXISTS "Authenticated users can update baplie_reconciliation_resolutions"
  ON public.baplie_reconciliation_resolutions;
DROP POLICY IF EXISTS baplie_reconciliation_resolutions_select_active
  ON public.baplie_reconciliation_resolutions;
DROP POLICY IF EXISTS baplie_reconciliation_resolutions_insert_active
  ON public.baplie_reconciliation_resolutions;
DROP POLICY IF EXISTS baplie_reconciliation_resolutions_update_active
  ON public.baplie_reconciliation_resolutions;
DROP POLICY IF EXISTS baplie_reconciliation_resolutions_delete_admin
  ON public.baplie_reconciliation_resolutions;

CREATE POLICY baplie_reconciliation_resolutions_select_active
  ON public.baplie_reconciliation_resolutions
  FOR SELECT TO authenticated
  USING (public.is_active_user());

CREATE POLICY baplie_reconciliation_resolutions_insert_active
  ON public.baplie_reconciliation_resolutions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user());

CREATE POLICY baplie_reconciliation_resolutions_update_active
  ON public.baplie_reconciliation_resolutions
  FOR UPDATE TO authenticated
  USING (public.is_active_user())
  WITH CHECK (public.is_active_user());

CREATE POLICY baplie_reconciliation_resolutions_delete_admin
  ON public.baplie_reconciliation_resolutions
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- baplie_containers ----------------------------------------------------------
ALTER TABLE public.baplie_containers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read baplie_containers"
  ON public.baplie_containers;
DROP POLICY IF EXISTS "Authenticated users can insert baplie_containers"
  ON public.baplie_containers;
DROP POLICY IF EXISTS "Authenticated users can update baplie_containers"
  ON public.baplie_containers;
DROP POLICY IF EXISTS "Authenticated users can delete baplie_containers"
  ON public.baplie_containers;
DROP POLICY IF EXISTS baplie_containers_select_active
  ON public.baplie_containers;
DROP POLICY IF EXISTS baplie_containers_insert_active
  ON public.baplie_containers;
DROP POLICY IF EXISTS baplie_containers_update_active
  ON public.baplie_containers;
DROP POLICY IF EXISTS baplie_containers_delete_active
  ON public.baplie_containers;
DROP POLICY IF EXISTS baplie_containers_delete_admin
  ON public.baplie_containers;

CREATE POLICY baplie_containers_select_active
  ON public.baplie_containers
  FOR SELECT TO authenticated
  USING (public.is_active_user());

CREATE POLICY baplie_containers_insert_active
  ON public.baplie_containers
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user());

CREATE POLICY baplie_containers_update_active
  ON public.baplie_containers
  FOR UPDATE TO authenticated
  USING (public.is_active_user())
  WITH CHECK (public.is_active_user());

CREATE POLICY baplie_containers_delete_admin
  ON public.baplie_containers
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- voyage_export_schedules ---------------------------------------------------
ALTER TABLE public.voyage_export_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read voyage_export_schedules"
  ON public.voyage_export_schedules;
DROP POLICY IF EXISTS "Authenticated users can insert voyage_export_schedules"
  ON public.voyage_export_schedules;
DROP POLICY IF EXISTS "Authenticated users can update voyage_export_schedules"
  ON public.voyage_export_schedules;
DROP POLICY IF EXISTS "Authenticated users can delete voyage_export_schedules"
  ON public.voyage_export_schedules;
DROP POLICY IF EXISTS voyage_export_schedules_select_active
  ON public.voyage_export_schedules;
DROP POLICY IF EXISTS voyage_export_schedules_insert_active
  ON public.voyage_export_schedules;
DROP POLICY IF EXISTS voyage_export_schedules_update_active
  ON public.voyage_export_schedules;
DROP POLICY IF EXISTS voyage_export_schedules_delete_active
  ON public.voyage_export_schedules;
DROP POLICY IF EXISTS voyage_export_schedules_delete_admin
  ON public.voyage_export_schedules;

CREATE POLICY voyage_export_schedules_select_active
  ON public.voyage_export_schedules
  FOR SELECT TO authenticated
  USING (public.is_active_user());

CREATE POLICY voyage_export_schedules_insert_active
  ON public.voyage_export_schedules
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user());

CREATE POLICY voyage_export_schedules_update_active
  ON public.voyage_export_schedules
  FOR UPDATE TO authenticated
  USING (public.is_active_user())
  WITH CHECK (public.is_active_user());

CREATE POLICY voyage_export_schedules_delete_admin
  ON public.voyage_export_schedules
  FOR DELETE TO authenticated
  USING (public.is_admin());
