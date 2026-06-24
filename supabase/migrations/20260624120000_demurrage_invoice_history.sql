-- Demurrage Fase 1.1 — Auditoria diária do valor recalculado da fatura.
-- Intent: registrar cada mudança de valor (nova PTAX, recálculo manual, pagamento)
--   de uma fatura de Demurrage não paga, para auditoria e para a janela de
--   conciliação das duas PTAX (ver ADR 0014 e ADR 0015).
-- Escopo: aditivo (nova tabela). Consumidores: Demurrage.tsx (staleness),
--   conciliação (Fase 7), portal (Fase 8).
-- Rollback: DROP TABLE public.demurrage_invoice_history.

CREATE TABLE IF NOT EXISTS public.demurrage_invoice_history (
  id            bigserial PRIMARY KEY,
  invoice_id    bigint NOT NULL REFERENCES public.demurrage_invoices(id) ON DELETE CASCADE,
  event_date    date NOT NULL,                 -- data da COTAÇÃO (dataHoraCotacao), não o run
  ptax_used     numeric(10,4) NOT NULL,
  roe_used      numeric(10,4) NOT NULL,         -- ptax × 1,065
  total_usd     numeric(12,2) NOT NULL,
  total_brl     numeric(14,2) NOT NULL,
  discount_usd  numeric(12,2) NOT NULL DEFAULT 0,
  source        text NOT NULL DEFAULT 'bcb_live'
                CHECK (source IN ('bcb_live', 'cached', 'manual', 'payment')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_demurrage_inv_hist_invoice
  ON public.demurrage_invoice_history(invoice_id);
CREATE INDEX IF NOT EXISTS idx_demurrage_inv_hist_date
  ON public.demurrage_invoice_history(invoice_id, event_date DESC, id DESC);

-- RLS: leitura para usuários autenticados (espelha demurrage_invoices). Escrita
-- somente via RPCs SECURITY DEFINER (recálculo/pagamento), que ignoram RLS — não
-- há política de INSERT/UPDATE/DELETE para o cliente por design (tabela de auditoria).
ALTER TABLE public.demurrage_invoice_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_demurrage_invoice_history"
  ON public.demurrage_invoice_history FOR SELECT
  TO authenticated USING (true);
