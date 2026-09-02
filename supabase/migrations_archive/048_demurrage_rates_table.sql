-- Migration 048: Tarifas de demurrage configuráveis no banco.
--
-- Contexto: as tarifas de demurrage estavam hardcoded em RATE_GROUPS dentro de
-- src/services/demurrage.ts. Qualquer mudança de tarifa exigia deploy de código.
-- Esta migration cria a tabela demurrage_rates com a estrutura necessária para
-- suportar as tarifas por tipo de container, faixas de dias e vigência.
--
-- Seed inicial com os valores atuais do código (RATE_GROUPS).

CREATE TABLE IF NOT EXISTS public.demurrage_rates (
  id               BIGSERIAL PRIMARY KEY,
  container_type   TEXT NOT NULL,           -- código do tipo, ex: '20GP'
  free_days        INT  NOT NULL DEFAULT 21, -- dias de free time
  p1_day_from      INT  NOT NULL,            -- início da faixa P1 (inclusive)
  p1_day_to        INT  NOT NULL,            -- fim da faixa P1 (inclusive, NULL = Infinity)
  p1_usd           NUMERIC(10,2) NOT NULL,   -- valor diário P1 em USD
  p2_day_from      INT  NOT NULL,            -- início da faixa P2
  p2_usd           NUMERIC(10,2) NOT NULL,   -- valor diário P2 em USD
  valid_from       DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to         DATE,                     -- NULL = sem expiração
  active           BOOLEAN NOT NULL DEFAULT true,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_demurrage_rates_updated_at ON public.demurrage_rates;
CREATE TRIGGER set_demurrage_rates_updated_at
BEFORE UPDATE ON public.demurrage_rates
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- RLS: leitura para todos os autenticados, escrita somente admin
ALTER TABLE public.demurrage_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "autenticados_leem_demurrage_rates" ON public.demurrage_rates;
CREATE POLICY "autenticados_leem_demurrage_rates"
  ON public.demurrage_rates FOR SELECT
  USING (auth.uid() IS NOT NULL AND public.is_active_user());

DROP POLICY IF EXISTS "admin_gerencia_demurrage_rates" ON public.demurrage_rates;
CREATE POLICY "admin_gerencia_demurrage_rates"
  ON public.demurrage_rates FOR ALL
  USING (public.is_active_user() AND public.is_admin())
  WITH CHECK (public.is_active_user() AND public.is_admin());

-- Seed: valores originais de RATE_GROUPS em src/services/demurrage.ts
INSERT INTO public.demurrage_rates
  (container_type, free_days, p1_day_from, p1_day_to, p1_usd, p2_day_from, p2_usd, notes)
VALUES
  -- 20 GP e variantes
  ('20GP',  21, 22, 30, 30, 31, 50,  'Grupo 20 Standard'),
  ('20G0',  21, 22, 30, 30, 31, 50,  'Grupo 20 Standard'),
  ('20HC',  21, 22, 30, 30, 31, 50,  'Grupo 20 Standard'),
  ('20HQ',  21, 22, 30, 30, 31, 50,  'Grupo 20 Standard'),
  ('22G1',  21, 22, 30, 30, 31, 50,  'Grupo 20 Standard'),
  ('20G1',  21, 22, 30, 30, 31, 50,  'Grupo 20 Standard'),
  -- 40 GP e variantes
  ('40GP',  21, 22, 30, 60, 31, 80,  'Grupo 40 Standard'),
  ('40G0',  21, 22, 30, 60, 31, 80,  'Grupo 40 Standard'),
  ('40HC',  21, 22, 30, 60, 31, 80,  'Grupo 40 Standard'),
  ('40HQ',  21, 22, 30, 60, 31, 80,  'Grupo 40 Standard'),
  ('40G1',  21, 22, 30, 60, 31, 80,  'Grupo 40 Standard'),
  ('42G1',  21, 22, 30, 60, 31, 80,  'Grupo 40 Standard'),
  ('45G1',  21, 22, 30, 60, 31, 80,  'Grupo 40 Standard'),
  -- 20 FR/OT
  ('20FR',  21, 22, 30, 50, 31, 80,  'Grupo 20 FR/OT'),
  ('20OT',  21, 22, 30, 50, 31, 80,  'Grupo 20 FR/OT'),
  ('20FT',  21, 22, 30, 50, 31, 80,  'Grupo 20 FR/OT'),
  -- 40 FR/OT
  ('40FR',  21, 22, 30, 100, 31, 140, 'Grupo 40 FR/OT'),
  ('40OT',  21, 22, 30, 100, 31, 140, 'Grupo 40 FR/OT'),
  ('40FT',  21, 22, 30, 100, 31, 140, 'Grupo 40 FR/OT'),
  -- 20 RF (refrigerado)
  ('20RF',  10, 11, 19, 95,  20, 110, 'Grupo 20 Reefer'),
  ('20RQ',  10, 11, 19, 95,  20, 110, 'Grupo 20 Reefer'),
  ('20R1',  10, 11, 19, 95,  20, 110, 'Grupo 20 Reefer'),
  -- 40 RF (refrigerado)
  ('40RF',  10, 11, 19, 190, 20, 220, 'Grupo 40 Reefer'),
  ('40RQ',  10, 11, 19, 190, 20, 220, 'Grupo 40 Reefer'),
  ('40R1',  10, 11, 19, 190, 20, 220, 'Grupo 40 Reefer'),
  ('45R1',  10, 11, 19, 190, 20, 220, 'Grupo 40 Reefer')
ON CONFLICT DO NOTHING;
