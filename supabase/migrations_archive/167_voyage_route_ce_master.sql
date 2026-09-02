-- 167_voyage_route_ce_master.sql
-- #322 (mapa #304): armazena CE Master por ROTA (POL/POD) da viagem, independente
-- de batch de manifesto. Viagem só-B/L não tem batch onde guardar a CE agrupadora
-- do Mercante; aqui ela fica por rota. CE Master não entra no EDI (só registro).

CREATE TABLE IF NOT EXISTS public.voyage_route_ce_master (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voyage_id BIGINT NOT NULL REFERENCES public.voyages(id) ON DELETE CASCADE,
  pol TEXT NOT NULL,
  pod TEXT NOT NULL,
  ce_master TEXT,
  updated_by UUID,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (voyage_id, pol, pod)
);
CREATE INDEX IF NOT EXISTS voyage_route_ce_master_voyage_idx ON public.voyage_route_ce_master(voyage_id);

ALTER TABLE public.voyage_route_ce_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read voyage_route_ce_master"   ON public.voyage_route_ce_master FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert voyage_route_ce_master" ON public.voyage_route_ce_master FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update voyage_route_ce_master" ON public.voyage_route_ce_master FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete voyage_route_ce_master" ON public.voyage_route_ce_master FOR DELETE TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.set_voyage_route_ce_master(
  p_voyage_id BIGINT, p_pol TEXT, p_pod TEXT, p_ce_master TEXT, p_changed_by UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_norm TEXT := NULLIF(btrim(COALESCE(p_ce_master, '')), '');
  v_pol TEXT := upper(btrim(COALESCE(p_pol, '')));
  v_pod TEXT := upper(btrim(COALESCE(p_pod, '')));
  v_old TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para editar CE Master.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem % nao encontrada', p_voyage_id USING ERRCODE = 'P0002';
  END IF;

  SELECT ce_master INTO v_old FROM public.voyage_route_ce_master
    WHERE voyage_id = p_voyage_id AND pol = v_pol AND pod = v_pod;

  INSERT INTO public.voyage_route_ce_master(voyage_id, pol, pod, ce_master, updated_by, updated_at)
  VALUES (p_voyage_id, v_pol, v_pod, v_norm, p_changed_by, now())
  ON CONFLICT (voyage_id, pol, pod)
  DO UPDATE SET ce_master = EXCLUDED.ce_master, updated_by = EXCLUDED.updated_by, updated_at = now();

  IF COALESCE(v_old, '') IS DISTINCT FROM COALESCE(v_norm, '') THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('voyage', p_voyage_id::TEXT, 'ce_master', NULLIF(v_old, ''), v_norm, p_changed_by,
            'CE Master por rota (viagem so-B/L)');
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_voyage_route_ce_master(BIGINT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_voyage_route_ce_master(BIGINT, TEXT, TEXT, TEXT, UUID) TO authenticated;
