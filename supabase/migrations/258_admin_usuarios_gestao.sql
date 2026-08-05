-- Migration: administração de usuários internos (listagem e auditoria)
--
-- Intent: permitir que a tela /admin/usuarios exiba e-mail e último acesso sem
--   expor auth.users ao papel authenticated, e registrar em audit_logs toda
--   mudança de setor (role) e de status (active).
-- Affected: nova RPC public.admin_list_users; novo trigger em public.user_profiles.
-- Breaking?: não. Nenhuma tabela é alterada.
--
-- Por que o trigger, e não o frontend: mudanças de role/active saem direto por
-- PostgREST a partir da tela, então o único ponto que cobre todos os chamadores
-- (presentes e futuros) é o banco.

CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  role TEXT,
  active BOOLEAN,
  created_at TIMESTAMPTZ,
  email TEXT,
  last_sign_in_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem listar usuários.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT
      p.id,
      p.full_name,
      p.role,
      p.active,
      p.created_at,
      u.email::TEXT,
      u.last_sign_in_at
    FROM public.user_profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    ORDER BY p.full_name;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_user_profile_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by)
    VALUES ('user_profile', NEW.id::TEXT, 'role', OLD.role, NEW.role, auth.uid());
  END IF;

  IF NEW.active IS DISTINCT FROM OLD.active THEN
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by)
    VALUES ('user_profile', NEW.id::TEXT, 'active', OLD.active::TEXT, NEW.active::TEXT, auth.uid());
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_user_profile_changes() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_audit_user_profile_changes ON public.user_profiles;
CREATE TRIGGER trg_audit_user_profile_changes
  AFTER UPDATE OF role, active ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_user_profile_changes();

-- Rollback:
--   drop trigger if exists trg_audit_user_profile_changes on public.user_profiles;
--   drop function if exists public.audit_user_profile_changes();
--   drop function if exists public.admin_list_users();
