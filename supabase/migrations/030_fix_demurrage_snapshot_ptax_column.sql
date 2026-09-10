-- 030: corrige a captura de snapshot de Demurrage no caminho com ROE publicado.
--
-- A tabela exchange_rate_reference_history chama a coluna de PTAX de `ptax`.
-- As migrations 023/027/028 consultavam a coluna `ptax_used`, nome da coluna
-- histórica da invoice, e só falhavam em runtime quando a emissão usava uma
-- cotação BCB/cached (o caminho manual não lê a tabela de referências).

CREATE OR REPLACE FUNCTION public.capture_demurrage_calculation_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_invoice_id bigint;
  v_invoice public.demurrage_invoices%ROWTYPE;
  v_items jsonb;
  v_inputs jsonb;
  v_result jsonb;
  v_hash text;
  v_ptax numeric;
  v_event_kind text := 'recalculation';
  v_presentation_total_brl numeric;
BEGIN
  IF TG_TABLE_NAME = 'demurrage_invoice_items' THEN
    IF TG_OP = 'DELETE' THEN
      v_invoice_id := OLD.invoice_id;
    ELSE
      v_invoice_id := NEW.invoice_id;
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      v_invoice_id := OLD.id;
    ELSE
      v_invoice_id := NEW.id;
    END IF;
  END IF;

  SELECT * INTO v_invoice
  FROM public.demurrage_invoices
  WHERE id = v_invoice_id;
  IF NOT FOUND OR v_invoice.status = 'draft' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.id), '[]'::jsonb)
    INTO v_items
  FROM (
    SELECT id, container_id, container_number, container_type, discharge_date,
           return_date, total_days, free_days, days_p1, rate_p1_usd,
           days_p2, rate_p2_usd, subtotal_usd, subtotal_brl
    FROM public.demurrage_invoice_items
    WHERE invoice_id = v_invoice_id
  ) AS item;

  SELECT CASE
           WHEN count(*) = 0 OR count(*) FILTER (WHERE item.subtotal_brl IS NULL) > 0 THEN NULL
           ELSE sum(item.subtotal_brl)
         END
    INTO v_presentation_total_brl
  FROM public.demurrage_invoice_items AS item
  WHERE item.invoice_id = v_invoice_id;

  IF v_invoice.roe_source = 'manual' THEN
    v_ptax := NULL;
  ELSE
    SELECT history.ptax INTO v_ptax
    FROM public.exchange_rate_reference_history AS history
    WHERE history.source = v_invoice.roe_source
      AND history.roe = v_invoice.current_roe
      AND history.effective_date <= COALESCE(v_invoice.updated_at::date, v_invoice.doc_date, CURRENT_DATE)
    ORDER BY history.effective_date DESC, history.id DESC
    LIMIT 1;
  END IF;

  IF TG_TABLE_NAME = 'demurrage_invoices' AND TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'paid' THEN
      v_event_kind := 'payment';
    ELSIF OLD.discount_value IS DISTINCT FROM NEW.discount_value
       OR OLD.discount_mode IS DISTINCT FROM NEW.discount_mode THEN
      v_event_kind := 'discount';
    END IF;
  ELSIF TG_TABLE_NAME = 'demurrage_invoice_items' AND TG_OP = 'INSERT'
        AND NOT EXISTS (
          SELECT 1 FROM public.demurrage_calculation_snapshots AS snapshot
          WHERE snapshot.demurrage_invoice_id = v_invoice_id
        ) THEN
    v_event_kind := 'initial';
  END IF;

  v_inputs := jsonb_build_object(
    'invoice_id', v_invoice.id,
    'bl_id', v_invoice.bl_id,
    'total_usd', v_invoice.total_usd,
    'discount_mode', v_invoice.discount_mode,
    'discount_value', v_invoice.discount_value,
    'current_roe', v_invoice.current_roe,
    'roe_source', v_invoice.roe_source,
    'ptax_used', v_ptax,
    'items', v_items
  );
  v_result := jsonb_build_object(
    'current_total_brl', v_invoice.current_total_brl,
    'presentation_total_brl', v_presentation_total_brl,
    'presentation_items', v_items,
    'pix_payload', v_invoice.pix_payload,
    'status', v_invoice.status
  );
  v_hash := encode(extensions.digest(v_inputs::text || v_result::text, 'sha256'), 'hex');

  INSERT INTO public.demurrage_calculation_snapshots(
    demurrage_invoice_id, calculation_version, input_hash,
    input_snapshot, result_snapshot, event_kind, created_by
  ) VALUES (
    v_invoice_id, 1, v_hash, v_inputs, v_result, v_event_kind, auth.uid()
  ) ON CONFLICT (demurrage_invoice_id, input_hash) DO NOTHING;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_demurrage_calculation_snapshot() FROM PUBLIC, anon, authenticated;
