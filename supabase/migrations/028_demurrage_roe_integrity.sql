-- F1/F5: fechar a fronteira entre o valor autoritativo da fatura e o que o
-- documento imprime. A linha BRL passa a ser um valor persistido pelo servidor;
-- o browser não reconverte subtotal_usd com um ROE que pode ter mudado.
--
-- A coluna é nullable de propósito: faturas legadas não tinham snapshot de
-- apresentação por linha e não devem ganhar uma cotação histórica inventada.
-- Emissões novas recebem valores em centavos e o primeiro item absorve o
-- resíduo determinístico necessário para que a soma das linhas seja o total
-- bruto autoritativo da fatura.

ALTER TABLE public.demurrage_invoice_items
  ADD COLUMN IF NOT EXISTS subtotal_brl numeric(14,2);

COMMENT ON COLUMN public.demurrage_invoice_items.subtotal_brl IS
  'Valor BRL bruto congelado para apresentação da linha; calculado pelo servidor na emissão, sem reconversão no browser.';

CREATE OR REPLACE FUNCTION public.refresh_demurrage_invoice_item_brl(p_invoice_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_total_usd numeric;
  v_current_roe numeric;
BEGIN
  SELECT invoice.total_usd, invoice.current_roe
    INTO v_total_usd, v_current_roe
  FROM public.demurrage_invoices AS invoice
  WHERE invoice.id = p_invoice_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Sem ROE válido não há conversão histórica segura. O documento exibirá a
  -- linha como indisponível, mas continuará usando o total persistido.
  IF v_current_roe IS NULL OR v_current_roe <= 0 OR lower(v_current_roe::text) = 'nan' THEN
    UPDATE public.demurrage_invoice_items
       SET subtotal_brl = NULL
     WHERE invoice_id = p_invoice_id;
    RETURN;
  END IF;

  WITH rounded AS (
    SELECT item.id,
           round(item.subtotal_usd * v_current_roe, 2) AS rounded_brl
    FROM public.demurrage_invoice_items AS item
    WHERE item.invoice_id = p_invoice_id
  ),
  aggregate AS (
    SELECT COALESCE(sum(rounded.rounded_brl), 0)::numeric AS rounded_sum,
           (SELECT candidate.id
            FROM rounded AS candidate
            ORDER BY candidate.rounded_brl DESC, candidate.id
            LIMIT 1) AS first_id
    FROM rounded
  ),
  target AS (
    SELECT round(v_total_usd * v_current_roe, 2)::numeric AS total_brl
  ),
  mapped AS (
    SELECT rounded.id,
           rounded.rounded_brl
             + CASE WHEN rounded.id = aggregate.first_id
                    THEN target.total_brl - aggregate.rounded_sum
                    ELSE 0
               END AS subtotal_brl
    FROM rounded
    CROSS JOIN aggregate
    CROSS JOIN target
  )
  UPDATE public.demurrage_invoice_items AS item
     SET subtotal_brl = mapped.subtotal_brl
    FROM mapped
   WHERE item.id = mapped.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_demurrage_invoice_item_brl()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM public.refresh_demurrage_invoice_item_brl(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END
  );
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_demurrage_invoice_items_brl_from_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM public.refresh_demurrage_invoice_item_brl(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS demurrage_invoice_brl_item_refresh
  ON public.demurrage_invoice_items;
CREATE TRIGGER demurrage_invoice_brl_item_refresh
  AFTER INSERT OR UPDATE OF invoice_id, subtotal_usd OR DELETE
  ON public.demurrage_invoice_items
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_demurrage_invoice_item_brl();

DROP TRIGGER IF EXISTS demurrage_invoice_brl_refresh
  ON public.demurrage_invoices;
CREATE TRIGGER demurrage_invoice_brl_refresh
  AFTER UPDATE OF total_usd, current_roe
  ON public.demurrage_invoices
  FOR EACH ROW
  WHEN (
    OLD.total_usd IS DISTINCT FROM NEW.total_usd
    OR OLD.current_roe IS DISTINCT FROM NEW.current_roe
  )
  EXECUTE FUNCTION public.sync_demurrage_invoice_items_brl_from_invoice();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.demurrage_invoices AS invoice
    WHERE invoice.roe IS NOT NULL
      AND (invoice.roe <= 0 OR invoice.roe > 1000 OR lower(invoice.roe::text) = 'nan')
  ) THEN
    RAISE EXCEPTION 'Demurrage possui roe fora da faixa segura; corrigir dados antes de validar a constraint.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.demurrage_invoices AS invoice
    WHERE invoice.current_roe IS NOT NULL
      AND (invoice.current_roe <= 0 OR invoice.current_roe > 1000 OR lower(invoice.current_roe::text) = 'nan')
  ) THEN
    RAISE EXCEPTION 'Demurrage possui current_roe fora da faixa segura; corrigir dados antes de validar a constraint.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.demurrage_invoices AS invoice
    WHERE invoice.roe_manual IS TRUE AND invoice.roe IS NULL
  ) THEN
    RAISE EXCEPTION 'Demurrage possui roe_manual sem roe; corrigir procedência antes de validar a constraint.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.demurrage_invoices AS invoice
    WHERE invoice.roe_source IS NOT NULL AND invoice.current_roe IS NULL
  ) THEN
    RAISE EXCEPTION 'Demurrage possui roe_source sem current_roe; corrigir procedência antes de validar a constraint.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.demurrage_invoices AS invoice
    WHERE invoice.roe_source IS NOT NULL
      AND invoice.roe_source NOT IN ('bcb_live', 'cached', 'manual')
  ) THEN
    RAISE EXCEPTION 'Demurrage possui origem de ROE desconhecida; corrigir procedência antes de validar a constraint.'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.demurrage_invoices'::regclass
      AND conname = 'demurrage_invoices_roe_sanity_check'
  ) THEN
    ALTER TABLE public.demurrage_invoices
      ADD CONSTRAINT demurrage_invoices_roe_sanity_check
      CHECK (roe IS NULL OR (roe > 0 AND roe <= 1000 AND lower(roe::text) <> 'nan'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.demurrage_invoices'::regclass
      AND conname = 'demurrage_invoices_current_roe_sanity_check'
  ) THEN
    ALTER TABLE public.demurrage_invoices
      ADD CONSTRAINT demurrage_invoices_current_roe_sanity_check
      CHECK (current_roe IS NULL OR (current_roe > 0 AND current_roe <= 1000 AND lower(current_roe::text) <> 'nan'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.demurrage_invoices'::regclass
      AND conname = 'demurrage_invoices_manual_roe_requires_value_check'
  ) THEN
    ALTER TABLE public.demurrage_invoices
      ADD CONSTRAINT demurrage_invoices_manual_roe_requires_value_check
      CHECK (roe_manual IS NOT TRUE OR roe IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.demurrage_invoices'::regclass
      AND conname = 'demurrage_invoices_roe_source_requires_current_check'
  ) THEN
    ALTER TABLE public.demurrage_invoices
      ADD CONSTRAINT demurrage_invoices_roe_source_requires_current_check
      CHECK (roe_source IS NULL OR current_roe IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.demurrage_invoices'::regclass
      AND conname = 'demurrage_invoices_roe_source_sanity_check'
  ) THEN
    ALTER TABLE public.demurrage_invoices
      ADD CONSTRAINT demurrage_invoices_roe_source_sanity_check
      CHECK (roe_source IS NULL OR roe_source IN ('bcb_live', 'cached', 'manual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.demurrage_invoice_items'::regclass
      AND conname = 'demurrage_invoice_items_subtotal_brl_check'
  ) THEN
    ALTER TABLE public.demurrage_invoice_items
      ADD CONSTRAINT demurrage_invoice_items_subtotal_brl_check
      CHECK (subtotal_brl IS NULL OR (subtotal_brl >= 0 AND lower(subtotal_brl::text) <> 'nan'));
  END IF;
END;
$$;

-- Captura a mesma projeção no snapshot append-only. Faturas antigas continuam
-- com as fotos originais; apenas novas fotos passam a declarar as linhas BRL.
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
    SELECT history.ptax_used INTO v_ptax
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

-- O cálculo de apresentação é interno e nunca recebe EXECUTE do browser.
REVOKE ALL ON FUNCTION public.refresh_demurrage_invoice_item_brl(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_demurrage_invoice_item_brl() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_demurrage_invoice_items_brl_from_invoice() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_demurrage_calculation_snapshot() FROM PUBLIC, anon, authenticated;

-- A atualização operacional continua permitida; ROE e sua marca de override
-- são contratos de servidor e não podem ser escritos por UPDATE PostgREST.
REVOKE UPDATE (roe, roe_manual) ON TABLE public.demurrage_invoices FROM anon, authenticated;
