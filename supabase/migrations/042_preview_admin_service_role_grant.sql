-- 042: allow the trusted Preview provisioning workflow to upsert profiles.
-- The service_role bypasses RLS, but it still needs table privileges. Keep the
-- browser roles unchanged and grant only what the provisioning upsert needs.
-- Rollback: REVOKE SELECT, INSERT, UPDATE ON TABLE public.user_profiles FROM service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.user_profiles TO service_role;
