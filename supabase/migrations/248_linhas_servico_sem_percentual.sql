-- Embarque de Vazios: o valor do serviço já incorpora qualquer majoração.
-- Percentual permanece nullable para preservar histórico, mas novos lançamentos
-- não aceitam percentual; NULL significa 100% implícito.
-- Rollback: restaurar a função validate_vazios_export_service_line da migration 239.

CREATE OR REPLACE FUNCTION public.validate_vazios_export_service_line()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_natureza TEXT;
  v_service_local UUID;
  v_service_destino UUID;
  v_service_condition TEXT;
  v_local_tipo TEXT;
BEGIN
  SELECT natureza, depot_id, route_destino_id, condition
    INTO v_natureza, v_service_local, v_service_destino, v_service_condition
  FROM public.depot_services WHERE id = NEW.service_id;
  SELECT tipo INTO v_local_tipo FROM public.depots WHERE id = NEW.local_id;

  IF v_natureza IS NULL OR v_service_local IS DISTINCT FROM NEW.local_id THEN
    RAISE EXCEPTION 'Servico deve pertencer ao local informado.' USING ERRCODE = '23514';
  END IF;
  IF v_natureza = 'armazenagem' THEN
    IF v_local_tipo <> 'depot' OR NEW.condition IS NULL
       OR v_service_condition IS DISTINCT FROM NEW.condition
       OR NEW.container_type IS NOT NULL OR NEW.destino_id IS NOT NULL
       OR NEW.percentual IS NOT NULL THEN
      RAISE EXCEPTION 'Armazenagem exige depot e a condicao do servico, sem tipo, rota ou percentual.' USING ERRCODE = '23514';
    END IF;
  ELSIF v_natureza = 'transporte' THEN
    IF v_service_destino IS NULL OR NEW.destino_id IS DISTINCT FROM v_service_destino
       OR NEW.condition IS NOT NULL OR NEW.percentual IS NOT NULL THEN
      RAISE EXCEPTION 'Transporte exige o destino vinculado ao servico, sem condicao ou percentual.' USING ERRCODE = '23514';
    END IF;
  ELSIF v_natureza = 'geral' THEN
    IF NEW.destino_id IS NOT NULL OR NEW.condition IS NOT NULL OR NEW.percentual IS NOT NULL THEN
      RAISE EXCEPTION 'Servico geral nao aceita rota, condicao ou percentual.' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Natureza de servico invalida.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_vazios_export_service_line() FROM PUBLIC, anon;
