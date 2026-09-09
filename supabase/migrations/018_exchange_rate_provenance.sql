-- 018: procedencia de ROE/PTAX e job de recálculo (S09).
--
-- A referência corrente continua sendo uma linha (id=1), mas agora guarda a
-- origem factual da cotação. O histórico separado permite auditar/repetir uma
-- publicação sem reconstruir PTAX a partir de uma ROE manual.

ALTER TABLE public.exchange_rate_reference
  ALTER COLUMN ptax DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS quote_date date,
  ADD COLUMN IF NOT EXISTS spread_version integer NOT NULL DEFAULT 1;

UPDATE public.exchange_rate_reference
   SET source = COALESCE(NULLIF(source, ''), 'manual'),
       quote_date = COALESCE(quote_date, effective_date),
       spread_version = COALESCE(spread_version, 1);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.exchange_rate_reference'::regclass
      AND conname = 'exchange_rate_reference_source_chk'
  ) THEN
    ALTER TABLE public.exchange_rate_reference
      ADD CONSTRAINT exchange_rate_reference_source_chk
      CHECK (source IN ('bcb_live', 'cached', 'manual'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.exchange_rate_reference'::regclass
      AND conname = 'exchange_rate_reference_values_chk'
  ) THEN
    ALTER TABLE public.exchange_rate_reference
      ADD CONSTRAINT exchange_rate_reference_values_chk
      CHECK (
        roe > 0 AND roe <= 1000
        AND (ptax IS NULL OR (ptax > 0 AND ptax <= 1000))
      );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.exchange_rate_reference_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('bcb_live', 'cached', 'manual')),
  ptax numeric(10,4),
  roe numeric(10,4) NOT NULL CHECK (roe > 0 AND roe <= 1000),
  effective_date date NOT NULL,
  quote_date date,
  spread_version integer NOT NULL DEFAULT 1,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS exchange_rate_reference_history_identity_idx
  ON public.exchange_rate_reference_history(
    source, effective_date, quote_date, (COALESCE(ptax, -1::numeric)), roe, spread_version
  );
CREATE INDEX IF NOT EXISTS exchange_rate_reference_history_date_idx
  ON public.exchange_rate_reference_history(effective_date DESC, quote_date DESC, id DESC);

ALTER TABLE public.exchange_rate_reference ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_rate_reference_history ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'exchange_rate_reference_history'
      AND policyname = 'exchange_rate_reference_history_select_active'
  ) THEN
    CREATE POLICY exchange_rate_reference_history_select_active
      ON public.exchange_rate_reference_history FOR SELECT TO authenticated
      USING (public.is_active_read_user());
  END IF;
END
$$;

REVOKE ALL ON TABLE public.exchange_rate_reference_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.exchange_rate_reference_history TO authenticated, service_role;
GRANT ALL ON TABLE public.exchange_rate_reference_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.exchange_rate_reference_history_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public._demurrage_spread_version()
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 1; $$;

CREATE OR REPLACE FUNCTION public._demurrage_roe_from_ptax(p_ptax numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT round(p_ptax * 1.065, 4);
$$;

CREATE OR REPLACE FUNCTION public.save_exchange_rate_reference_v2(
  p_ptax numeric,
  p_roe numeric,
  p_effective_date date,
  p_source text,
  p_quote_date date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_source text := NULLIF(btrim(COALESCE(p_source, '')), '');
  v_quote_date date := COALESCE(p_quote_date, p_effective_date);
  v_spread_version integer := public._demurrage_spread_version();
  v_actor uuid := auth.uid();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  IF v_source NOT IN ('bcb_live', 'cached', 'manual')
     OR p_effective_date IS NULL
     OR p_roe IS NULL OR p_roe <= 0 OR p_roe > 1000
     OR p_roe::text = 'NaN'
     OR v_quote_date IS NULL THEN
    RAISE EXCEPTION 'Referencia cambial invalida.' USING ERRCODE = '22023';
  END IF;
  IF v_source IN ('bcb_live', 'cached')
     AND (p_ptax IS NULL OR p_ptax <= 0 OR p_ptax > 1000 OR p_ptax::text = 'NaN') THEN
    RAISE EXCEPTION 'PTAX obrigatoria para origem %.', v_source USING ERRCODE = '22023';
  END IF;
  IF p_ptax IS NOT NULL AND (p_ptax <= 0 OR p_ptax > 1000 OR p_ptax::text = 'NaN') THEN
    RAISE EXCEPTION 'PTAX invalida.' USING ERRCODE = '22023';
  END IF;
  IF v_source IN ('bcb_live', 'cached')
     AND p_roe IS DISTINCT FROM public._demurrage_roe_from_ptax(p_ptax) THEN
    RAISE EXCEPTION 'ROE divergente da PTAX e do spread vigente.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.exchange_rate_reference_history(
    source, ptax, roe, effective_date, quote_date, spread_version, recorded_by
  ) VALUES (
    v_source, p_ptax, p_roe, p_effective_date, v_quote_date, v_spread_version, v_actor
  ) ON CONFLICT DO NOTHING;

  INSERT INTO public.exchange_rate_reference(
    id, ptax, roe, effective_date, updated_at, source, quote_date, spread_version
  ) VALUES (
    1, p_ptax, p_roe, p_effective_date, now(), v_source, v_quote_date, v_spread_version
  )
  ON CONFLICT (id) DO UPDATE
  SET ptax = EXCLUDED.ptax,
      roe = EXCLUDED.roe,
      effective_date = EXCLUDED.effective_date,
      updated_at = now(),
      source = EXCLUDED.source,
      quote_date = EXCLUDED.quote_date,
      spread_version = EXCLUDED.spread_version;

  RETURN jsonb_build_object(
    'source', v_source,
    'ptax', p_ptax,
    'roe', p_roe,
    'effective_date', p_effective_date,
    'quote_date', v_quote_date,
    'spread_version', v_spread_version
  );
END;
$$;

-- Compatibilidade para callers antigos: uma escrita sem procedencia explicita
-- e manual, nunca uma falsa cotacao BCB.
CREATE OR REPLACE FUNCTION public.save_exchange_rate_reference(
  p_ptax numeric,
  p_roe numeric,
  p_effective_date date
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM public.save_exchange_rate_reference_v2(
    p_ptax, p_roe, p_effective_date, 'manual', p_effective_date
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_demurrage_invoices(
  p_ptax numeric,
  p_quote_date date,
  p_source text DEFAULT 'bcb_live'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_roe numeric;
  v_updated integer := 0;
  v_inv record;
  v_total_brl numeric(14,2);
  v_pix_payload text;
  v_discount_usd numeric(12,2);
BEGIN
  IF p_ptax IS NULL OR p_ptax <= 0 OR p_ptax > 1000 OR p_ptax::text = 'NaN'
     OR p_quote_date IS NULL THEN
    RAISE EXCEPTION 'PTAX e data de cotacao sao obrigatorias.' USING ERRCODE = '22023';
  END IF;
  IF p_source NOT IN ('bcb_live', 'cached', 'manual') THEN
    RAISE EXCEPTION 'Origem de PTAX invalida: %.', p_source USING ERRCODE = '22023';
  END IF;

  v_roe := public._demurrage_roe_from_ptax(p_ptax);
  PERFORM public.save_exchange_rate_reference_v2(
    p_ptax, v_roe, p_quote_date, p_source, p_quote_date
  );

  FOR v_inv IN
    SELECT id, total_usd, COALESCE(discount_value, 0) AS discount_value,
           discount_mode, doc_number, current_roe
    FROM public.demurrage_invoices
    WHERE status = 'issued' AND paid_at IS NULL
    FOR UPDATE
  LOOP
    CONTINUE WHEN v_inv.current_roe IS NOT NULL AND v_inv.current_roe = v_roe;

    v_discount_usd := 0;
    IF v_inv.discount_value > 0 THEN
      IF v_inv.discount_mode = 'percent' THEN
        v_discount_usd := round(v_inv.total_usd * (v_inv.discount_value / 100), 2);
      ELSE
        v_discount_usd := v_inv.discount_value;
      END IF;
    END IF;

    v_total_brl := round(greatest(v_inv.total_usd - v_discount_usd, 0) * v_roe, 2);
    v_pix_payload := CASE
      WHEN v_total_brl > 0 THEN public.build_transshipping_pix_payload(v_total_brl, v_inv.doc_number)
      ELSE NULL
    END;

    UPDATE public.demurrage_invoices
       SET current_roe = v_roe,
           current_total_brl = v_total_brl,
           roe_source = p_source,
           pix_payload = v_pix_payload,
           updated_at = now()
     WHERE id = v_inv.id;

    INSERT INTO public.demurrage_invoice_history(
      invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source
    ) VALUES (
      v_inv.id, p_quote_date, p_ptax, v_roe, v_inv.total_usd, v_total_brl, v_discount_usd, p_source
    );
    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated, 'roe', v_roe, 'quote_date', p_quote_date, 'source', p_source);
END;
$$;

-- A foto inicial usa somente a PTAX realmente registrada para a mesma origem e
-- ROE. Para um override manual, PTAX permanece NULL: nunca se fabrica uma
-- cotacao inversa a partir do markup.
CREATE OR REPLACE FUNCTION public.create_demurrage_invoice_with_items(
  p_doc_number text,
  p_bl_id text,
  p_customer_id bigint,
  p_total_usd numeric,
  p_ready_at date,
  p_roe_manual boolean,
  p_roe numeric,
  p_current_roe numeric,
  p_roe_source text,
  p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_invoice_id bigint;
  v_customer_id bigint;
  v_item_count integer;
  v_invalid_container_count integer;
  v_inconsistent_item_count integer;
  v_item_total numeric(14,2);
  v_total_brl numeric(14,2);
  v_pix_payload text;
  v_ptax numeric(10,4);
  v_business_date date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(TRIM(COALESCE(p_doc_number, '')), '') IS NULL
     OR NULLIF(TRIM(COALESCE(p_bl_id, '')), '') IS NULL
     OR p_customer_id IS NULL
     OR COALESCE(p_total_usd, 0) <= 0
     OR p_current_roe IS NULL OR p_current_roe <= 0
     OR p_roe_source NOT IN ('bcb_live', 'cached', 'manual')
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Dados invalidos para criar invoice de Demurrage.' USING ERRCODE = '22023';
  END IF;

  SELECT b.customer_id
    INTO v_customer_id
    FROM public.bls b
   WHERE b.id = p_bl_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.demurrage_invoices di
    WHERE di.bl_id = p_bl_id AND di.status IN ('issued', 'paid')
  ) THEN
    RAISE EXCEPTION 'Ja existe fatura de Demurrage emitida ou paga para o B/L %. Cancele a fatura atual antes de reemitir.', p_bl_id
      USING ERRCODE = '23505';
  END IF;

  IF v_customer_id IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'Cliente informado nao corresponde ao cliente do B/L %.', p_bl_id USING ERRCODE = '22023';
  END IF;

  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE bc.id IS NULL OR bc.bl_id IS DISTINCT FROM p_bl_id)::integer,
    COUNT(*) FILTER (
      WHERE item.discharge_date IS NULL
         OR item.return_date IS NULL
         OR item.return_date < item.discharge_date
         OR COALESCE(item.total_days, -1) <> (item.return_date - item.discharge_date)
         OR COALESCE(item.free_days, -1) < 0
         OR COALESCE(item.days_p1, -1) < 0
         OR COALESCE(item.days_p2, -1) < 0
         OR COALESCE(item.rate_p1_usd, -1) < 0
         OR COALESCE(item.rate_p2_usd, -1) < 0
         OR item.days_p1 + item.days_p2 > GREATEST(item.total_days - item.free_days, 0)
         OR ABS(COALESCE(item.subtotal_usd, -1)
                - (item.days_p1 * item.rate_p1_usd + item.days_p2 * item.rate_p2_usd)) > 0.01
    )::integer,
    COALESCE(SUM(item.subtotal_usd), 0)
    INTO v_item_count, v_invalid_container_count, v_inconsistent_item_count, v_item_total
    FROM jsonb_to_recordset(p_items) AS item(
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
    )
    LEFT JOIN public.bl_containers bc ON bc.id = item.container_id;

  IF v_item_count = 0 OR v_invalid_container_count > 0 THEN
    RAISE EXCEPTION 'Itens de Demurrage invalidos para o B/L %.', p_bl_id USING ERRCODE = '22023';
  END IF;

  IF v_inconsistent_item_count > 0 THEN
    RAISE EXCEPTION 'Calculo de Demurrage inconsistente em % item(ns) do B/L %.', v_inconsistent_item_count, p_bl_id
      USING ERRCODE = '22023';
  END IF;

  IF ABS(v_item_total - p_total_usd) > 0.01 THEN
    RAISE EXCEPTION 'Total dos itens diverge do total da invoice de Demurrage.' USING ERRCODE = '22023';
  END IF;

  IF p_roe_source IN ('bcb_live', 'cached') THEN
    SELECT reference.ptax
      INTO v_ptax
      FROM public.exchange_rate_reference AS reference
     WHERE reference.id = 1
       AND reference.source = p_roe_source
       AND reference.roe = p_current_roe
       AND reference.ptax IS NOT NULL
     FOR SHARE;
    IF v_ptax IS NULL THEN
      RAISE EXCEPTION 'Snapshot cambial sem PTAX registrada para a origem %.', p_roe_source
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Sem desconto na criacao (descontos sao aplicados depois, em USD).
  v_total_brl := ROUND(p_total_usd * p_current_roe, 2);
  v_pix_payload := public.build_transshipping_pix_payload(v_total_brl, TRIM(p_doc_number));

  INSERT INTO public.demurrage_invoices (
    doc_number, bl_id, customer_id, total_usd, ready_at,
    roe_manual, roe, status, billed_at, first_billed_at,
    current_roe, current_total_brl, roe_source, pix_payload
  ) VALUES (
    TRIM(p_doc_number), p_bl_id, p_customer_id, p_total_usd, p_ready_at,
    COALESCE(p_roe_manual, false), p_roe, 'issued', v_business_date, v_business_date,
    p_current_roe, v_total_brl, p_roe_source, v_pix_payload
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
    FROM jsonb_to_recordset(p_items) AS item(
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
    (v_invoice_id, v_business_date, v_ptax, p_current_roe, p_total_usd, v_total_brl, 0, p_roe_source);

  RETURN jsonb_build_object('invoice_id', v_invoice_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_demurrage_invoices_manual(p_ptax numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  RETURN public.recalculate_demurrage_invoices(
    p_ptax,
    (now() AT TIME ZONE 'America/Sao_Paulo')::date,
    'manual'
  );
END;
$$;

REVOKE ALL ON FUNCTION public._demurrage_spread_version() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._demurrage_roe_from_ptax(numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_exchange_rate_reference_v2(numeric, numeric, date, text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_exchange_rate_reference_v2(numeric, numeric, date, text, date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_exchange_rate_reference(numeric, numeric, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_exchange_rate_reference(numeric, numeric, date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.recalculate_demurrage_invoices(numeric, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_demurrage_invoices(numeric, date, text) TO service_role;
REVOKE ALL ON FUNCTION public.recalculate_demurrage_invoices_manual(numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_demurrage_invoices_manual(numeric) TO authenticated;

-- O agendamento NAO acontece aqui.
--
-- A versao anterior desta migration criava o job e o desativava com
-- `UPDATE cron.job SET active = false`. Isso aborta o replay em qualquer
-- ambiente Supabase real com
--
--   ERROR: permission denied for table job (SQLSTATE 42501)
--
-- porque o papel que aplica migrations nao tem UPDATE na tabela cron.job;
-- cron.schedule/cron.unschedule funcionam por serem funcoes da extensao. O
-- gate `Migration replay` nao pega o caso: scripts/setup-local-pg.sh cria
-- cron.job como tabela comum do superusuario local, onde o UPDATE passa.
-- Como a falha interrompe a aplicacao aqui, as migrations seguintes tambem
-- nao chegavam a rodar.
--
-- A intencao declarada era que "a ativacao e uma operacao explicita, nao
-- efeito colateral do replay de migrations". Nao criar o job entrega
-- exatamente isso, sem depender de ACL: o agendamento vira passo operacional,
-- registrado em docs/operations/segredos-cron.md, executado apos validar
-- segredo, Edge e gateway conforme a S09.
--
-- Se um dia o job precisar nascer junto do schema, o caminho e
-- cron.alter_job(jobid, active := false) -- funcao da extensao --, e o shim de
-- scripts/setup-local-pg.sh precisa ganhar alter_job para o replay local
-- continuar representativo.
