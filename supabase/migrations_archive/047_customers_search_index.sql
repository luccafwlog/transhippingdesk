-- Migration 047: Índice trigram para busca rápida de clientes por nome/CNPJ.
--
-- Contexto: listBillingCustomers usava limit 300 com filtro ilike client-side.
-- Com este índice a busca por nome/cnpj_cpf fica eficiente mesmo com milhares
-- de registros.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_customers_name_trgm
  ON public.customers USING gin(name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_customers_cnpj_cpf_trgm
  ON public.customers USING gin(cnpj_cpf gin_trgm_ops);
