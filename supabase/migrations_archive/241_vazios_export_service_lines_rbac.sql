-- ADR 0033: quem pode operar Vazios EXP também pode manter suas linhas.
-- Rollback: recriar a policy com public.can_edit_depots().

DROP POLICY IF EXISTS vazios_export_service_lines_write ON public.vazios_export_service_lines;
CREATE POLICY vazios_export_service_lines_write ON public.vazios_export_service_lines
  FOR ALL TO authenticated
  USING (public.is_active_user() OR public.is_equipamentos_user())
  WITH CHECK (public.is_active_user() OR public.is_equipamentos_user());
