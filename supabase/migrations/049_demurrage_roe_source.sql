-- Migration 049: Rastreabilidade da fonte do ROE em faturas de demurrage.
--
-- Contexto: fetchROE() pode retornar câmbio ao vivo (BCB PTAX) ou de cache
-- localStorage (quando BCB está offline). Não havia forma de saber qual fonte
-- foi usada numa determinada fatura — risco de auditoria financeira.
--
-- Esta migration adiciona roe_source à demurrage_invoices e atualiza os RPCs
-- de emissão e marcação de pagamento para gravar a fonte.

ALTER TABLE public.demurrage_invoices
  ADD COLUMN IF NOT EXISTS roe_source TEXT
    CHECK (roe_source IN ('bcb_live', 'cached', 'manual'));

COMMENT ON COLUMN public.demurrage_invoices.roe_source IS
  'Fonte do ROE: bcb_live = PTAX em tempo real, cached = cache localStorage, manual = informado manualmente.';
