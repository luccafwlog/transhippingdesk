-- Migration 366: Acordos de Demurrage customizados por Cliente (Issue 627)
--
-- Permite definir condicoes comerciais diferenciadas de free time e tarifas
-- diarias de sobreestadia (P1/P2) por cliente, com controle de vigencia e
-- restricao de nao-sobreposicao temporal via btree_gist.
--
-- Rollback:
-- DROP TABLE IF EXISTS public.customer_demurrage_agreements CASCADE;

CREATE TABLE IF NOT EXISTS public.customer_demurrage_agreements (
  id           BIGSERIAL PRIMARY KEY,
  customer_id  BIGINT NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  free_days    INTEGER NOT NULL,
  p1_usd       NUMERIC(10, 2), -- NULL = herda da tabela padrao (demurrage_rates)
  p2_usd       NUMERIC(10, 2), -- NULL = herda da tabela padrao (demurrage_rates)
  valid_from   DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to     DATE,           -- NULL = sem data de termino
  active       BOOLEAN NOT NULL DEFAULT true,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT customer_demurrage_agreements_free_days_check
    CHECK (free_days >= 0 AND free_days <= 365),
  CONSTRAINT customer_demurrage_agreements_p1_usd_check
    CHECK (p1_usd IS NULL OR p1_usd >= 0),
  CONSTRAINT customer_demurrage_agreements_p2_usd_check
    CHECK (p2_usd IS NULL OR p2_usd >= 0),
  CONSTRAINT customer_demurrage_agreements_dates_check
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE INDEX IF NOT EXISTS idx_customer_demurrage_agreements_customer_id
  ON public.customer_demurrage_agreements (customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_demurrage_agreements_dates
  ON public.customer_demurrage_agreements (valid_from, valid_to);

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.customer_demurrage_agreements
  ADD CONSTRAINT customer_demurrage_agreements_no_overlap
  EXCLUDE USING gist (
    customer_id WITH =,
    daterange(valid_from, valid_to, '[]') WITH &&
  )
  WHERE (active = true);

DROP TRIGGER IF EXISTS set_customer_demurrage_agreements_updated_at ON public.customer_demurrage_agreements;
CREATE TRIGGER set_customer_demurrage_agreements_updated_at
BEFORE UPDATE ON public.customer_demurrage_agreements
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- RLS: leitura para todos os autenticados ativos, escrita/gestao para admin/operador autorizado
ALTER TABLE public.customer_demurrage_agreements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "autenticados_leem_customer_demurrage_agreements" ON public.customer_demurrage_agreements;
CREATE POLICY "autenticados_leem_customer_demurrage_agreements"
  ON public.customer_demurrage_agreements FOR SELECT
  USING (auth.uid() IS NOT NULL AND public.is_active_user());

DROP POLICY IF EXISTS "admin_gerencia_customer_demurrage_agreements" ON public.customer_demurrage_agreements;
CREATE POLICY "admin_gerencia_customer_demurrage_agreements"
  ON public.customer_demurrage_agreements FOR ALL
  USING (public.is_active_user() AND public.is_admin())
  WITH CHECK (public.is_active_user() AND public.is_admin());
