-- Reforça a fronteira da RPC administrativa já aplicada remotamente pela
-- versão timestamp 20260805210838. PUBLIC não cobre grants diretos a anon.

REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;
