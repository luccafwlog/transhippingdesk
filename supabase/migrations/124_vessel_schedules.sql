-- Renumbered from 20260616000000 (original timestamped migration: 20260616000000_vessel_schedules.sql).
-- ============================================================================
-- Chegadas e Saídas: tabelas de escala de navios (widget do Portal do Cliente)
-- Unificação das migrations originais do projeto Lovable em uma só criação.
--
-- Origem (6 migrations Lovable, jan–jun 2026):
--   - criação de vessel_schedules + trigger + realtime + RLS
--   - criação de ended_vessels (histórico) + RLS
--   - remoção de policies permissivas antigas de vessel_schedules
--   - acréscimo de display_order em vessel_schedules
--   - acréscimo de pecem_eta nas duas tabelas
--
-- Aqui: criação única já no estado final, sem os passos intermediários.
-- RLS ajustada: SELECT para clientes autenticados do Portal; escrita só admin
-- interno (public.is_admin() consulta user_profiles — clientes do Portal não
-- estão nessa tabela, logo is_admin() = false para eles).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- vessel_schedules: navios "vivos" no line-up (escala em andamento)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vessel_schedules (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    vessel_name     text        NOT NULL,
    voyage          text        NOT NULL,
    imo_number      text,
    -- ETD (saída / embarque) — portos de carregamento
    qingdao_etd     text        DEFAULT 'X',
    shanghai_etd    text        DEFAULT 'X',
    taicang_etd     text        DEFAULT 'X',
    ningbo_etd      text        DEFAULT 'X',
    nansha_etd      text        DEFAULT 'X',
    -- ETA (chegada / descarga) — portos de descarga
    pecem_eta       text        DEFAULT 'X',
    salvador_eta    text        DEFAULT 'X',
    vitoria_eta     text        DEFAULT 'X',
    display_order   integer     DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vessel_schedules ENABLE ROW LEVEL SECURITY;

-- Padrão do TD (ver 010_rls_by_role.sql): tabela operacional.
--   SELECT: qualquer usuário autenticado (clientes do Portal + internos).
--   INSERT/UPDATE: qualquer usuário interno ativo (admin OU operator).
--   DELETE: somente admin.
CREATE POLICY "vessel_schedules_select_authenticated"
ON public.vessel_schedules
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "vessel_schedules_insert_active"
ON public.vessel_schedules
FOR INSERT
TO authenticated
WITH CHECK (public.is_active_user());

CREATE POLICY "vessel_schedules_update_active"
ON public.vessel_schedules
FOR UPDATE
TO authenticated
USING (public.is_active_user())
WITH CHECK (public.is_active_user());

CREATE POLICY "vessel_schedules_delete_admin"
ON public.vessel_schedules
FOR DELETE
TO authenticated
USING (public.is_admin());

-- updated_at automático.
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_vessel_schedules_updated_at ON public.vessel_schedules;
CREATE TRIGGER update_vessel_schedules_updated_at
BEFORE UPDATE ON public.vessel_schedules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime para atualização ao vivo do widget.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END;
$$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.vessel_schedules;

-- ---------------------------------------------------------------------------
-- ended_vessels: histórico de navios encerrados
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ended_vessels (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    original_id     uuid,
    vessel_name     text        NOT NULL,
    voyage          text        NOT NULL,
    qingdao_etd     text        DEFAULT 'X',
    shanghai_etd    text        DEFAULT 'X',
    taicang_etd     text        DEFAULT 'X',
    ningbo_etd      text        DEFAULT 'X',
    nansha_etd      text        DEFAULT 'X',
    pecem_eta       text        DEFAULT 'X',
    salvador_eta    text        DEFAULT 'X',
    vitoria_eta     text        DEFAULT 'X',
    imo_number      text,
    ended_at        timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ended_vessels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view ended vessels"
ON public.ended_vessels
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "ended_vessels_insert_active"
ON public.ended_vessels
FOR INSERT
TO authenticated
WITH CHECK (public.is_active_user());

CREATE POLICY "ended_vessels_delete_admin"
ON public.ended_vessels
FOR DELETE
TO authenticated
USING (public.is_admin());
