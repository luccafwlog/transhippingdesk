-- 183: Rate limit da Edge Function por CNPJ normalizado, usando hash.
CREATE OR REPLACE FUNCTION public.portal_login_check_rate_limit(p_login TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_hash TEXT; v_count INTEGER;
BEGIN
  v_hash := encode(extensions.digest(regexp_replace(coalesce(p_login,''),'\D','','g'),'sha256'),'hex');
  SELECT count(*) INTO v_count FROM public.portal_login_attempts WHERE cnpj_hash=v_hash AND attempted_at > now()-interval '15 minutes' AND succeeded=false;
  RETURN coalesce(v_count,0) >= 5;
END; $$;
REVOKE ALL ON FUNCTION public.portal_login_check_rate_limit(TEXT) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.portal_login_register_failure(p_login TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
  INSERT INTO public.portal_login_attempts(cnpj_hash,succeeded)
  VALUES (encode(extensions.digest(regexp_replace(coalesce(p_login,''),'\D','','g'),'sha256'),'hex'),false);
END; $$;
REVOKE ALL ON FUNCTION public.portal_login_register_failure(TEXT) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.portal_login_register_success(p_login TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
  INSERT INTO public.portal_login_attempts(cnpj_hash,succeeded)
  VALUES (encode(extensions.digest(regexp_replace(coalesce(p_login,''),'\D','','g'),'sha256'),'hex'),true);
END; $$;
REVOKE ALL ON FUNCTION public.portal_login_register_success(TEXT) FROM PUBLIC,anon,authenticated;
