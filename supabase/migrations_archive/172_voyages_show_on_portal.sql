-- ADR 0021: viagens exibidas no quadro "Programacao de Navios" do Portal.
-- Default false: viagens criadas manualmente / por manifesto nao aparecem ao
-- cliente ate serem marcadas. O cadastro por Chegadas e Saidas liga a flag.
ALTER TABLE public.voyages
  ADD COLUMN IF NOT EXISTS show_on_portal boolean NOT NULL DEFAULT false;

-- Indice parcial: o Portal so consulta viagens visiveis e ativas.
CREATE INDEX IF NOT EXISTS voyages_show_on_portal_active_idx
  ON public.voyages (show_on_portal)
  WHERE show_on_portal AND status = 'active';
