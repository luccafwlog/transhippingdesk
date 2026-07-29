-- ADR 0033: linhas de servico do Embarque de Vazios e Cadastro de Terminais.

ALTER TABLE public.depots
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'depot',
  ADD COLUMN IF NOT EXISTS free_time_vazio_days INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_time_material_days INTEGER NOT NULL DEFAULT 0,
  DROP COLUMN IF EXISTS free_time_days,
  DROP COLUMN IF EXISTS pol_port;

ALTER TABLE public.depots
  ADD CONSTRAINT depots_tipo_check CHECK (tipo IN ('depot', 'terminal_portuario')),
  ADD CONSTRAINT depots_free_time_check CHECK (
    free_time_vazio_days >= 0 AND free_time_material_days >= 0
    AND (tipo = 'depot' OR (free_time_vazio_days = 0 AND free_time_material_days = 0))
  );

ALTER TABLE public.vazios_export_operations DROP COLUMN IF EXISTS os_number;

CREATE TABLE public.vazios_export_service_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES public.vazios_export_operations(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.depot_services(id) ON DELETE RESTRICT,
  local_id UUID NOT NULL REFERENCES public.depots(id) ON DELETE RESTRICT,
  destino_id UUID REFERENCES public.depots(id) ON DELETE RESTRICT,
  container_type TEXT,
  condition TEXT CHECK (condition IS NULL OR condition IN ('vazio', 'material')),
  quantidade NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (quantidade >= 0),
  percentual NUMERIC(5,2) CHECK (percentual IS NULL OR percentual IN (50, 100)),
  valor_unitario NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (valor_unitario >= 0),
  valor_sugerido NUMERIC(12,2) CHECK (valor_sugerido IS NULL OR valor_sugerido >= 0),
  quantidade_manual BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vazios_export_service_lines_operation ON public.vazios_export_service_lines(operation_id);
CREATE INDEX idx_vazios_export_service_lines_service ON public.vazios_export_service_lines(service_id);
CREATE UNIQUE INDEX uq_vazios_storage_line_operation_local_condition
  ON public.vazios_export_service_lines(operation_id, local_id, condition)
  WHERE condition IS NOT NULL;

DROP TABLE IF EXISTS public.vazios_operation_service_qty;

ALTER TABLE public.vazios_export_service_lines ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vazios_export_service_lines TO authenticated;
CREATE POLICY vazios_export_service_lines_select ON public.vazios_export_service_lines
  FOR SELECT TO authenticated USING (public.is_active_read_user());
CREATE POLICY vazios_export_service_lines_write ON public.vazios_export_service_lines
  FOR ALL TO authenticated USING (public.can_edit_depots()) WITH CHECK (public.can_edit_depots());
