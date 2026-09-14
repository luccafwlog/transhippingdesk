-- Reestablish the required singleton after production data drift.
-- Rollback: do not delete this row; its absence breaks all app-settings reads.
INSERT INTO public.app_settings (
  id,
  communications_enabled,
  demurrage_dunning_interval_days
)
VALUES (1, false, 7)
ON CONFLICT (id) DO NOTHING;
