-- Cadastro de Depot: serviços precificados por tipo de cálculo (ADR 0032).
-- Overtime é marcado por serviço; o percentual continua por container.

ALTER TABLE public.depots
  ADD COLUMN IF NOT EXISTS free_time_days INTEGER NOT NULL DEFAULT 0
    CHECK (free_time_days >= 0);

ALTER TABLE public.depot_services
  DROP CONSTRAINT IF EXISTS depot_services_charge_basis_check,
  ADD COLUMN IF NOT EXISTS calc_type TEXT,
  ADD COLUMN IF NOT EXISTS subject_to_overtime BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.depot_services
SET calc_type = CASE charge_basis
  WHEN 'per_container_flag' THEN 'fixo_por_container'
  WHEN 'per_operation_qty' THEN 'quantidade'
  ELSE 'quantidade'
END
WHERE calc_type IS NULL;

ALTER TABLE public.depot_services
  ALTER COLUMN calc_type SET NOT NULL,
  ADD CONSTRAINT depot_services_calc_type_check
    CHECK (calc_type IN ('fixo_por_container', 'storage_por_dias', 'quantidade'));

ALTER TABLE public.depot_services DROP COLUMN IF EXISTS charge_basis;

ALTER TABLE public.vazios_bookings
  ADD COLUMN IF NOT EXISTS overtime_pct NUMERIC(6,2) NOT NULL DEFAULT 0
    CHECK (overtime_pct >= 0);

ALTER TABLE public.vazios_bookings
  DROP COLUMN IF EXISTS bundle,
  DROP COLUMN IF EXISTS transporte,
  DROP COLUMN IF EXISTS visual_check,
  DROP COLUMN IF EXISTS overtime_handling,
  DROP COLUMN IF EXISTS overtime_transport,
  DROP COLUMN IF EXISTS overtime_handling_pct,
  DROP COLUMN IF EXISTS overtime_transport_pct;

CREATE TABLE IF NOT EXISTS public.vazios_operation_service_qty (
  operation_id UUID NOT NULL REFERENCES public.vazios_export_operations(id) ON DELETE CASCADE,
  depot_service_id UUID NOT NULL REFERENCES public.depot_services(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  PRIMARY KEY (operation_id, depot_service_id)
);

ALTER TABLE public.vazios_operation_service_qty ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vazios_operation_service_qty TO authenticated;

DROP POLICY IF EXISTS vazios_operation_service_qty_select ON public.vazios_operation_service_qty;
CREATE POLICY vazios_operation_service_qty_select
  ON public.vazios_operation_service_qty FOR SELECT TO authenticated
  USING (public.is_active_read_user());

DROP POLICY IF EXISTS vazios_operation_service_qty_insert ON public.vazios_operation_service_qty;
CREATE POLICY vazios_operation_service_qty_insert
  ON public.vazios_operation_service_qty FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR public.is_equipamentos_user());

DROP POLICY IF EXISTS vazios_operation_service_qty_update ON public.vazios_operation_service_qty;
CREATE POLICY vazios_operation_service_qty_update
  ON public.vazios_operation_service_qty FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.is_equipamentos_user())
  WITH CHECK (public.is_admin() OR public.is_equipamentos_user());

DROP POLICY IF EXISTS vazios_operation_service_qty_delete ON public.vazios_operation_service_qty;
CREATE POLICY vazios_operation_service_qty_delete
  ON public.vazios_operation_service_qty FOR DELETE TO authenticated
  USING (public.is_admin() OR public.is_equipamentos_user());

DROP TABLE IF EXISTS public.vazios_reorg_services CASCADE;
DROP TABLE IF EXISTS public.vazios_reorg_rates CASCADE;
DROP TABLE IF EXISTS public.vazios_export_overtime_depots CASCADE;
DROP TABLE IF EXISTS public.depot_tariffs CASCADE;
