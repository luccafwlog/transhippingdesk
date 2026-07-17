-- 200: Referência cambial autoritativa para header, recálculo e Portal.
-- Rollback: DROP FUNCTIONs e DROP TABLE public.exchange_rate_reference.

CREATE TABLE public.exchange_rate_reference (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ptax NUMERIC(10,4) NOT NULL,
  roe NUMERIC(10,4) NOT NULL,
  effective_date DATE NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.exchange_rate_reference ENABLE ROW LEVEL SECURITY;

CREATE POLICY exchange_rate_reference_internal_read
ON public.exchange_rate_reference FOR SELECT TO authenticated
USING (public._portal_actor_role() IS NOT NULL);

CREATE OR REPLACE FUNCTION public.save_exchange_rate_reference(
  p_ptax NUMERIC,
  p_roe NUMERIC,
  p_effective_date DATE
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND public._portal_actor_role() IS NULL THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.exchange_rate_reference (id, ptax, roe, effective_date, updated_at)
  VALUES (1, p_ptax, p_roe, p_effective_date, now())
  ON CONFLICT (id) DO UPDATE
  SET ptax = EXCLUDED.ptax,
      roe = EXCLUDED.roe,
      effective_date = EXCLUDED.effective_date,
      updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_get_current_roe()
RETURNS TABLE (roe NUMERIC, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM public.current_portal_customer_id();
  RETURN QUERY
  SELECT reference.roe, reference.updated_at
  FROM public.exchange_rate_reference AS reference
  WHERE reference.id = 1;
END;
$$;

REVOKE ALL ON TABLE public.exchange_rate_reference FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.exchange_rate_reference TO authenticated;
REVOKE ALL ON FUNCTION public.save_exchange_rate_reference(NUMERIC, NUMERIC, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_exchange_rate_reference(NUMERIC, NUMERIC, DATE) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_get_current_roe() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_get_current_roe() TO authenticated;
