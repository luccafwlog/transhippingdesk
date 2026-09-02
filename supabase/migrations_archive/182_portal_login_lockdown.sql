-- 182: A resolução de CNPJ não fica disponível ao navegador.
REVOKE EXECUTE ON FUNCTION public.portal_resolve_login(TEXT) FROM anon, authenticated, PUBLIC;
