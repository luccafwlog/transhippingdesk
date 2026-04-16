-- Fase 2: Regras comerciais por cliente
-- Adiciona campos de prazo de pagamento, desconto e notas comerciais na tabela de clientes.
-- Valores default conservadores: 30 dias, 0% desconto.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER DEFAULT 30,
  ADD COLUMN IF NOT EXISTS discount_pct NUMERIC(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commercial_notes TEXT;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_payment_terms_days_check
    CHECK (payment_terms_days IS NULL OR (payment_terms_days > 0 AND payment_terms_days <= 365));

ALTER TABLE public.customers
  ADD CONSTRAINT customers_discount_pct_check
    CHECK (discount_pct IS NULL OR (discount_pct >= 0 AND discount_pct < 100));
