-- Renumbered from 20260610094207 (original timestamped migration: 20260610094207_confirm_demurrage_pix_matches_batch.sql).
------------------------------------------------------------------------
-- RPC para conciliar demurrage por PIX em lote (uma round-trip).
--
-- confirmUnifiedPixReconciliation() fazia um UPDATE por fatura de
-- demurrage conciliada (audit F25/T18). Esta função recebe o lote em
-- jsonb e aplica tudo em um único statement.
--
-- SECURITY INVOKER (default): a autorização continua sendo das policies
-- RLS de demurrage_invoices, exatamente como no UPDATE direto que o
-- cliente fazia antes. Retorna o número de linhas efetivamente
-- atualizadas — o cliente compara com o tamanho do lote e acusa
-- divergência (antes, um UPDATE que não casasse nenhuma linha passava
-- silenciosamente).
--
-- Rollback: DROP FUNCTION public.confirm_demurrage_pix_matches(jsonb);
------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_demurrage_pix_matches(p_matches jsonb)
RETURNS integer
LANGUAGE sql
SET search_path = ''
AS $$
  WITH input AS (
    SELECT (m->>'invoice_id')::bigint AS invoice_id,
           (m->>'paid_at')::date      AS paid_at,
           NULLIF(m->>'pix_txid', '') AS pix_txid
    FROM jsonb_array_elements(p_matches) AS m
  ),
  updated AS (
    UPDATE public.demurrage_invoices d
    SET status = 'paid',
        paid_at = i.paid_at,
        pix_txid = i.pix_txid,
        conciliated_by_extract = true
    FROM input i
    WHERE d.id = i.invoice_id
    RETURNING d.id
  )
  SELECT count(*)::integer FROM updated;
$$;

-- Default-deny (ADR 0011): anon não executa funções do domínio financeiro.
REVOKE EXECUTE ON FUNCTION public.confirm_demurrage_pix_matches(jsonb) FROM PUBLIC, anon;
