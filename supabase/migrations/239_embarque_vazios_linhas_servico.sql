-- ADR 0033: linhas de servico do Embarque de Vazios e Cadastro de Terminais.

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

CREATE OR REPLACE FUNCTION public.validate_vazios_export_service_line()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_natureza TEXT;
  v_service_local UUID;
  v_local_tipo TEXT;
BEGIN
  SELECT natureza, depot_id INTO v_natureza, v_service_local
  FROM public.depot_services WHERE id = NEW.service_id;
  SELECT tipo INTO v_local_tipo FROM public.depots WHERE id = NEW.local_id;

  IF v_natureza IS NULL OR v_service_local IS DISTINCT FROM NEW.local_id THEN
    RAISE EXCEPTION 'Servico deve pertencer ao local informado.' USING ERRCODE = '23514';
  END IF;
  IF v_natureza = 'armazenagem' THEN
    IF v_local_tipo <> 'depot' OR NEW.condition IS NULL OR NEW.container_type IS NOT NULL
       OR NEW.destino_id IS NOT NULL OR NEW.percentual IS NOT NULL THEN
      RAISE EXCEPTION 'Armazenagem exige depot e condicao, sem tipo, rota ou percentual.' USING ERRCODE = '23514';
    END IF;
  ELSIF v_natureza = 'transporte' THEN
    IF NEW.destino_id IS NULL OR NEW.condition IS NOT NULL OR NEW.percentual NOT IN (50, 100) THEN
      RAISE EXCEPTION 'Transporte exige rota, sem condicao e percentual de 50 ou 100.' USING ERRCODE = '23514';
    END IF;
  ELSIF v_natureza = 'geral' THEN
    IF NEW.destino_id IS NOT NULL OR NEW.condition IS NOT NULL OR NEW.percentual NOT IN (50, 100) THEN
      RAISE EXCEPTION 'Servico geral nao aceita rota ou condicao e exige percentual de 50 ou 100.' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Natureza de servico invalida.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_vazios_export_service_line() FROM PUBLIC, anon;
CREATE TRIGGER validate_vazios_export_service_line
  BEFORE INSERT OR UPDATE ON public.vazios_export_service_lines
  FOR EACH ROW EXECUTE FUNCTION public.validate_vazios_export_service_line();

DROP TABLE IF EXISTS public.vazios_operation_service_qty;

ALTER TABLE public.vazios_export_service_lines ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vazios_export_service_lines TO authenticated;
CREATE POLICY vazios_export_service_lines_select ON public.vazios_export_service_lines
  FOR SELECT TO authenticated USING (public.is_active_read_user());
CREATE POLICY vazios_export_service_lines_write ON public.vazios_export_service_lines
  FOR ALL TO authenticated USING (public.can_edit_depots()) WITH CHECK (public.can_edit_depots());
