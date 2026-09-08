-- 023: autoridade server-side do cálculo de Demurrage e foto financeira.
--
-- A emissão recebe somente a identidade dos containers. Tarifas, acordos,
-- overrides, datas, câmbio e total são resolvidos no banco. A foto resultante
-- é append-only e serve para documento, auditoria e futuras revalidações.

ALTER TABLE public.demurrage_invoice_history
  ALTER COLUMN ptax_used DROP NOT NULL;

COMMENT ON COLUMN public.demurrage_invoice_history.ptax_used IS
  'PTAX factual da foto. NULL é permitido somente quando a origem é manual e apenas o ROE foi informado.';

CREATE TABLE IF NOT EXISTS public.demurrage_calculation_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  demurrage_invoice_id bigint NOT NULL REFERENCES public.demurrage_invoices(id) ON DELETE RESTRICT,
  calculation_version integer NOT NULL DEFAULT 1 CHECK (calculation_version > 0),
  input_hash text NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  input_snapshot jsonb NOT NULL CHECK (jsonb_typeof(input_snapshot) = 'object'),
  result_snapshot jsonb NOT NULL CHECK (jsonb_typeof(result_snapshot) = 'object'),
  event_kind text NOT NULL CHECK (event_kind IN ('initial', 'recalculation', 'discount', 'payment')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS demurrage_calculation_snapshots_identity_idx
  ON public.demurrage_calculation_snapshots(demurrage_invoice_id, input_hash);
CREATE INDEX IF NOT EXISTS demurrage_calculation_snapshots_invoice_date_idx
  ON public.demurrage_calculation_snapshots(demurrage_invoice_id, created_at DESC, id DESC);

ALTER TABLE public.demurrage_calculation_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.demurrage_calculation_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.demurrage_calculation_snapshots TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.demurrage_calculation_snapshots_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_demurrage_calculation_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RAISE EXCEPTION 'Fotos de cálculo de Demurrage são append-only.' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS demurrage_calculation_snapshots_append_only
  ON public.demurrage_calculation_snapshots;
CREATE TRIGGER demurrage_calculation_snapshots_append_only
  BEFORE UPDATE OR DELETE ON public.demurrage_calculation_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.prevent_demurrage_calculation_snapshot_mutation();

CREATE OR REPLACE FUNCTION public._calculate_demurrage_invoice_authoritative(
  p_bl_id text,
  p_container_ids bigint[],
  p_calculation_date date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requested_count integer := COALESCE(array_length(p_container_ids, 1), 0);
  v_distinct_count integer;
  v_result jsonb;
BEGIN
  IF NULLIF(btrim(p_bl_id), '') IS NULL
     OR v_requested_count = 0
     OR p_calculation_date IS NULL THEN
    RAISE EXCEPTION 'B/L, containers e data de cálculo são obrigatórios.' USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT requested.id)::integer
    INTO v_distinct_count
  FROM unnest(p_container_ids) AS requested(id);
  IF v_distinct_count <> v_requested_count THEN
    RAISE EXCEPTION 'A emissão de Demurrage não aceita container duplicado.' USING ERRCODE = '22023';
  END IF;

  WITH requested AS (
    SELECT requested.id
    FROM unnest(p_container_ids) AS requested(id)
  ), base AS (
    SELECT
      container.id,
      container.bl_id,
      container.container_number,
      container.type,
      container.discharge_date,
      container.return_date,
      container.demurrage_status,
      bl.customer_id,
      bl.free_time_override,
      bl.demurrage_rate_override_p1_usd,
      bl.demurrage_rate_override_p2_usd,
      CASE upper(trim(COALESCE(container.type, '')))
        WHEN '20GP' THEN '20GP'
        WHEN '20G0' THEN '20GP'
        WHEN '20HC' THEN '20GP'
        WHEN '20HQ' THEN '20GP'
        WHEN '22G1' THEN '20GP'
        WHEN '20G1' THEN '20GP'
        WHEN '40GP' THEN '40GP'
        WHEN '40G0' THEN '40GP'
        WHEN '40HC' THEN '40GP'
        WHEN '40HQ' THEN '40GP'
        WHEN '40G1' THEN '40GP'
        WHEN '42G1' THEN '40GP'
        WHEN '45G1' THEN '40GP'
        WHEN '20FR' THEN '20FR'
        WHEN '20OT' THEN '20FR'
        WHEN '20FT' THEN '20FR'
        WHEN '40FR' THEN '40FR'
        WHEN '40OT' THEN '40FR'
        WHEN '40FT' THEN '40FR'
        WHEN '20RF' THEN '20RF'
        WHEN '20RQ' THEN '20RF'
        WHEN '20R1' THEN '20RF'
        WHEN '40RF' THEN '40RF'
        WHEN '40RQ' THEN '40RF'
        WHEN '40R1' THEN '40RF'
        WHEN '45R1' THEN '40RF'
        ELSE upper(trim(COALESCE(container.type, '')))
      END AS canonical_type
    FROM requested
    LEFT JOIN public.bl_containers AS container
      ON container.id = requested.id
     AND container.bl_id = p_bl_id
    LEFT JOIN public.bls AS bl ON bl.id = container.bl_id
  ), resolved AS (
    SELECT
      base.*,
      rate.free_days AS table_free_days,
      rate.p1_day_to,
      rate.p1_usd AS table_p1_usd,
      rate.p2_day_from,
      rate.p2_usd AS table_p2_usd,
      agreement.free_days AS agreement_free_days,
      agreement.p1_usd AS agreement_p1_usd,
      agreement.p2_usd AS agreement_p2_usd
    FROM base
    LEFT JOIN LATERAL (
      SELECT r.free_days, r.p1_day_to, r.p1_usd, r.p2_day_from, r.p2_usd
      FROM public.demurrage_rates AS r
      WHERE r.active = true
        AND r.valid_from <= p_calculation_date
        AND (r.valid_to IS NULL OR r.valid_to >= p_calculation_date)
        AND upper(trim(r.container_type)) = base.canonical_type
      ORDER BY r.valid_from DESC, r.id DESC
      LIMIT 1
    ) AS rate ON true
    LEFT JOIN LATERAL (
      SELECT a.free_days, a.p1_usd, a.p2_usd
      FROM public.customer_demurrage_agreements AS a
      WHERE a.customer_id = base.customer_id
        AND a.active = true
        AND base.discharge_date >= a.valid_from
        AND (a.valid_to IS NULL OR base.discharge_date <= a.valid_to)
      ORDER BY a.valid_from DESC, a.id DESC
      LIMIT 1
    ) AS agreement ON true
  ), calculated AS (
    SELECT
      resolved.*,
      (resolved.return_date - resolved.discharge_date)::integer AS total_days,
      COALESCE(resolved.free_time_override, resolved.agreement_free_days, resolved.table_free_days) AS free_days,
      COALESCE(resolved.demurrage_rate_override_p1_usd, resolved.agreement_p1_usd, resolved.table_p1_usd) AS rate_p1_usd,
      COALESCE(resolved.demurrage_rate_override_p2_usd, resolved.agreement_p2_usd, resolved.table_p2_usd) AS rate_p2_usd
    FROM resolved
  ), valued AS (
    SELECT
      calculated.*,
      GREATEST(0, LEAST(calculated.total_days, calculated.p1_day_to) - calculated.free_days)::integer AS days_p1,
      GREATEST(
        0,
        calculated.total_days - GREATEST(calculated.p2_day_from, calculated.free_days + 1) + 1
      )::integer AS days_p2
    FROM calculated
  ), totals AS (
    SELECT
      valued.*,
      round(valued.days_p1 * valued.rate_p1_usd + valued.days_p2 * valued.rate_p2_usd, 2) AS subtotal_usd,
      (
        valued.id IS NULL
        OR valued.bl_id IS NULL
        OR valued.demurrage_status NOT IN ('overdue', 'returned')
        OR valued.discharge_date IS NULL
        OR valued.return_date IS NULL
        OR valued.return_date < valued.discharge_date
        OR valued.total_days < 0
        OR valued.free_days IS NULL
        OR valued.free_days < 0
        OR valued.p1_day_to IS NULL
        OR valued.p2_day_from IS NULL
        OR valued.rate_p1_usd IS NULL
        OR valued.rate_p2_usd IS NULL
        OR valued.rate_p1_usd < 0
        OR valued.rate_p2_usd < 0
      ) AS invalid
    FROM valued
  )
  SELECT jsonb_build_object(
    'items', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'container_id', totals.id,
          'container_number', totals.container_number,
          'container_type', totals.type,
          'discharge_date', totals.discharge_date,
          'return_date', totals.return_date,
          'total_days', totals.total_days,
          'free_days', totals.free_days,
          'days_p1', totals.days_p1,
          'rate_p1_usd', totals.rate_p1_usd,
          'days_p2', totals.days_p2,
          'rate_p2_usd', totals.rate_p2_usd,
          'subtotal_usd', totals.subtotal_usd
        ) ORDER BY totals.id
      ) FILTER (WHERE NOT totals.invalid AND totals.subtotal_usd > 0),
      '[]'::jsonb
    ),
    'total_usd', COALESCE(sum(totals.subtotal_usd) FILTER (WHERE NOT totals.invalid AND totals.subtotal_usd > 0), 0),
    'ready_at', CASE WHEN bool_and(totals.return_date IS NOT NULL) THEN max(totals.return_date) ELSE NULL END,
    'requested_count', count(*)::integer,
    'calculated_count', count(*) FILTER (WHERE NOT totals.invalid AND totals.subtotal_usd > 0)::integer,
    'invalid_count', count(*) FILTER (WHERE totals.invalid)::integer
  )
    INTO v_result
  FROM totals;

  IF COALESCE((v_result->>'requested_count')::integer, 0) <> v_requested_count THEN
    RAISE EXCEPTION 'Um ou mais containers não pertencem ao B/L informado.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE((v_result->>'invalid_count')::integer, 0) > 0 THEN
    RAISE EXCEPTION 'Dados insuficientes ou tarifa inválida para calcular a Demurrage.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE((v_result->>'calculated_count')::integer, 0) <> v_requested_count THEN
    RAISE EXCEPTION 'Nenhum container faturável ou conjunto de containers desatualizado.' USING ERRCODE = '22023';
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_demurrage_invoice_authoritative(
  p_doc_number text,
  p_bl_id text,
  p_customer_id bigint,
  p_container_ids bigint[],
  p_expected_updated_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl public.bls%ROWTYPE;
  v_reference public.exchange_rate_reference%ROWTYPE;
  v_calculation jsonb;
  v_items jsonb;
  v_invoice_id bigint;
  v_total_usd numeric(12,2);
  v_current_roe numeric(10,4);
  v_ptax numeric(10,4);
  v_roe_source text;
  v_total_brl numeric(14,2);
  v_pix_payload text;
  v_business_date date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_ready_at date;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_doc_number), '') IS NULL
     OR NULLIF(btrim(p_bl_id), '') IS NULL
     OR p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Documento, B/L e cliente são obrigatórios.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_bl
  FROM public.bls
  WHERE id = p_bl_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF v_bl.customer_id IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'Cliente informado não corresponde ao cliente do B/L %.', p_bl_id USING ERRCODE = '22023';
  END IF;
  IF p_expected_updated_at IS NOT NULL AND v_bl.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Prévia de Demurrage desatualizada; recalcule antes de emitir.' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.demurrage_invoices AS invoice
    WHERE invoice.bl_id = p_bl_id AND invoice.status IN ('issued', 'paid')
  ) THEN
    RAISE EXCEPTION 'Já existe fatura de Demurrage emitida ou paga para o B/L %. Cancele a fatura atual antes de reemitir.', p_bl_id
      USING ERRCODE = '23505';
  END IF;

  IF COALESCE(v_bl.demurrage_roe_manual, false) THEN
    IF v_bl.demurrage_roe IS NULL OR v_bl.demurrage_roe <= 0 OR v_bl.demurrage_roe::text = 'NaN' THEN
      RAISE EXCEPTION 'ROE manual inválido no B/L %.', p_bl_id USING ERRCODE = '22023';
    END IF;
    v_current_roe := round(v_bl.demurrage_roe, 4);
    v_roe_source := 'manual';
    v_ptax := NULL;
  ELSE
    SELECT * INTO v_reference
    FROM public.exchange_rate_reference
    WHERE id = 1
    FOR SHARE;
    IF NOT FOUND OR v_reference.roe IS NULL OR v_reference.roe <= 0 THEN
      RAISE EXCEPTION 'Referência cambial vigente indisponível para emitir Demurrage.' USING ERRCODE = 'P0001';
    END IF;
    v_current_roe := round(v_reference.roe, 4);
    v_roe_source := COALESCE(NULLIF(v_reference.source, ''), 'manual');
    v_ptax := v_reference.ptax;
    IF v_roe_source IN ('bcb_live', 'cached') AND (v_ptax IS NULL OR v_ptax <= 0) THEN
      RAISE EXCEPTION 'Referência cambial sem PTAX factual para a origem %.', v_roe_source USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_calculation := public._calculate_demurrage_invoice_authoritative(
    p_bl_id,
    p_container_ids,
    v_business_date
  );
  v_items := v_calculation->'items';
  v_total_usd := round((v_calculation->>'total_usd')::numeric, 2);
  v_ready_at := NULLIF(v_calculation->>'ready_at', '')::date;
  IF v_total_usd IS NULL OR v_total_usd <= 0 OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Nenhum container com sobreestadia para este B/L.' USING ERRCODE = '22023';
  END IF;

  v_total_brl := round(v_total_usd * v_current_roe, 2);
  v_pix_payload := CASE
    WHEN v_total_brl > 0 THEN public.build_transshipping_pix_payload(v_total_brl, trim(p_doc_number))
    ELSE NULL
  END;

  INSERT INTO public.demurrage_invoices (
    doc_number, bl_id, customer_id, total_usd, ready_at,
    roe_manual, roe, status, billed_at, first_billed_at,
    current_roe, current_total_brl, roe_source, pix_payload
  ) VALUES (
    trim(p_doc_number), p_bl_id, p_customer_id, v_total_usd, v_ready_at,
    COALESCE(v_bl.demurrage_roe_manual, false), v_bl.demurrage_roe, 'issued',
    v_business_date, v_business_date, v_current_roe, v_total_brl, v_roe_source, v_pix_payload
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.demurrage_invoice_items (
    invoice_id, container_id, container_number, container_type,
    discharge_date, return_date, total_days, free_days,
    days_p1, rate_p1_usd, days_p2, rate_p2_usd, subtotal_usd
  )
  SELECT
    v_invoice_id, item.container_id, item.container_number, item.container_type,
    item.discharge_date, item.return_date, item.total_days, item.free_days,
    item.days_p1, item.rate_p1_usd, item.days_p2, item.rate_p2_usd, item.subtotal_usd
  FROM jsonb_to_recordset(v_items) AS item(
    container_id bigint,
    container_number text,
    container_type text,
    discharge_date date,
    return_date date,
    total_days integer,
    free_days integer,
    days_p1 integer,
    rate_p1_usd numeric,
    days_p2 integer,
    rate_p2_usd numeric,
    subtotal_usd numeric
  );

  INSERT INTO public.demurrage_invoice_history
    (invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
  VALUES
    (v_invoice_id, v_business_date, v_ptax, v_current_roe, v_total_usd, v_total_brl, 0, v_roe_source);

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'total_usd', v_total_usd,
    'current_total_brl', v_total_brl,
    'current_roe', v_current_roe,
    'roe_source', v_roe_source,
    'calculation_version', 1
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_demurrage_calculation_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_invoice_id bigint := CASE WHEN TG_TABLE_NAME = 'demurrage_invoice_items' THEN COALESCE(NEW.invoice_id, OLD.invoice_id) ELSE COALESCE(NEW.id, OLD.id) END;
  v_invoice public.demurrage_invoices%ROWTYPE;
  v_items jsonb;
  v_inputs jsonb;
  v_result jsonb;
  v_hash text;
  v_ptax numeric;
  v_event_kind text := 'recalculation';
BEGIN
  SELECT * INTO v_invoice
  FROM public.demurrage_invoices
  WHERE id = v_invoice_id;
  IF NOT FOUND OR v_invoice.status = 'draft' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.id), '[]'::jsonb)
    INTO v_items
  FROM (
    SELECT id, container_id, container_number, container_type, discharge_date,
           return_date, total_days, free_days, days_p1, rate_p1_usd,
           days_p2, rate_p2_usd, subtotal_usd
    FROM public.demurrage_invoice_items
    WHERE invoice_id = v_invoice_id
  ) AS item;

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

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS demurrage_invoice_financial_snapshot
  ON public.demurrage_invoices;
CREATE TRIGGER demurrage_invoice_financial_snapshot
  AFTER UPDATE OF total_usd, current_roe, current_total_brl, discount_value,
    discount_mode, pix_payload, roe_source ON public.demurrage_invoices
  FOR EACH ROW
  WHEN (
    OLD.total_usd IS DISTINCT FROM NEW.total_usd
    OR OLD.current_roe IS DISTINCT FROM NEW.current_roe
    OR OLD.current_total_brl IS DISTINCT FROM NEW.current_total_brl
    OR OLD.discount_value IS DISTINCT FROM NEW.discount_value
    OR OLD.discount_mode IS DISTINCT FROM NEW.discount_mode
    OR OLD.pix_payload IS DISTINCT FROM NEW.pix_payload
    OR OLD.roe_source IS DISTINCT FROM NEW.roe_source
  )
  EXECUTE FUNCTION public.capture_demurrage_calculation_snapshot();

DROP TRIGGER IF EXISTS demurrage_invoice_items_calculation_snapshot
  ON public.demurrage_invoice_items;
CREATE CONSTRAINT TRIGGER demurrage_invoice_items_calculation_snapshot
  AFTER INSERT OR UPDATE OR DELETE ON public.demurrage_invoice_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.capture_demurrage_calculation_snapshot();

REVOKE ALL ON FUNCTION public.prevent_demurrage_calculation_snapshot_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._calculate_demurrage_invoice_authoritative(text, bigint[], date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_demurrage_invoice_authoritative(text, text, bigint, bigint[], timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_demurrage_calculation_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_demurrage_invoice_authoritative(text, text, bigint, bigint[], timestamptz) TO authenticated, service_role;

-- O contrato antigo aceitava linhas e total calculados pelo browser. Nenhum
-- caller ativo usa mais essa entrada; mantê-la somente para execução interna
-- durante a transição evita que uma aplicação desatualizada reconquiste a
-- autoridade financeira.
REVOKE ALL ON FUNCTION public.create_demurrage_invoice_with_items(text, text, bigint, numeric, date, boolean, numeric, numeric, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_demurrage_invoice_with_items(text, text, bigint, numeric, date, boolean, numeric, numeric, text, jsonb)
  TO service_role;
