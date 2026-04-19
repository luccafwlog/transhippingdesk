-- Migration 039: Integrar B/Ls Granito ao fluxo de faturamento
-- 1. Tabela invoice_granite_bls (ligacao invoice <-> granite_bls)
-- 2. Indice composto em granite_bls para performance de billing
-- 3. RPC create_invoice_from_granite_bls

CREATE TABLE IF NOT EXISTS public.invoice_granite_bls (
  id            BIGSERIAL PRIMARY KEY,
  invoice_id    BIGINT NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  granite_bl_id UUID   NOT NULL REFERENCES public.granite_bls(id) ON DELETE RESTRICT,
  subtotal_brl  NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, granite_bl_id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_granite_bls_invoice ON public.invoice_granite_bls(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_granite_bls_bl     ON public.invoice_granite_bls(granite_bl_id);
CREATE INDEX IF NOT EXISTS idx_granite_bls_billing        ON public.granite_bls(charge_status, client_id);

-- RLS
ALTER TABLE public.invoice_granite_bls ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS invoice_granite_bls_select ON public.invoice_granite_bls;
  CREATE POLICY invoice_granite_bls_select
    ON public.invoice_granite_bls FOR SELECT TO authenticated
    USING (auth.role() = 'authenticated');

  DROP POLICY IF EXISTS invoice_granite_bls_insert ON public.invoice_granite_bls;
  CREATE POLICY invoice_granite_bls_insert
    ON public.invoice_granite_bls FOR INSERT TO authenticated
    WITH CHECK (auth.role() = 'authenticated');

  DROP POLICY IF EXISTS invoice_granite_bls_update ON public.invoice_granite_bls;
  CREATE POLICY invoice_granite_bls_update
    ON public.invoice_granite_bls FOR UPDATE TO authenticated
    USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

  DROP POLICY IF EXISTS invoice_granite_bls_delete ON public.invoice_granite_bls;
  CREATE POLICY invoice_granite_bls_delete
    ON public.invoice_granite_bls FOR DELETE TO authenticated
    USING (auth.role() = 'authenticated');
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_granite_bls TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.invoice_granite_bls_id_seq TO authenticated;

-- RPC: emitir invoice a partir de B/Ls Granito
CREATE OR REPLACE FUNCTION public.create_invoice_from_granite_bls(
  p_granite_bl_ids UUID[],
  p_customer_id    BIGINT DEFAULT NULL,
  p_due_date       DATE   DEFAULT NULL,
  p_notes          TEXT   DEFAULT NULL,
  p_actor          UUID   DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_id    BIGINT;
  v_invoice_id     BIGINT;
  v_invoice_number TEXT;
  v_total_brl      NUMERIC(14,2);
  v_bl_count       INT;
BEGIN
  IF p_granite_bl_ids IS NULL OR array_length(p_granite_bl_ids, 1) = 0 THEN
    RAISE EXCEPTION 'PT409: Nenhum B/L Granito selecionado.';
  END IF;

  -- Validar que todos os BLs existem e estao prontos
  IF (SELECT COUNT(*) FROM public.granite_bls WHERE id = ANY(p_granite_bl_ids)) <> array_length(p_granite_bl_ids, 1) THEN
    RAISE EXCEPTION 'PT409: Um ou mais B/Ls Granito nao foram encontrados.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.granite_bls
    WHERE id = ANY(p_granite_bl_ids)
      AND charge_status <> 'ready_for_billing'
  ) THEN
    RAISE EXCEPTION 'PT409: Um ou mais B/Ls Granito nao estao prontos para faturar (charge_status != ready_for_billing).';
  END IF;

  -- Verificar que nao ha invoice existente para os BLs
  IF EXISTS (
    SELECT 1 FROM public.invoice_granite_bls
    WHERE granite_bl_id = ANY(p_granite_bl_ids)
  ) THEN
    RAISE EXCEPTION 'PT409: Um ou mais B/Ls Granito ja estao vinculados a uma invoice.';
  END IF;

  -- Resolver cliente
  IF p_customer_id IS NOT NULL THEN
    v_customer_id := p_customer_id;
  ELSE
    SELECT DISTINCT client_id
    INTO v_customer_id
    FROM public.granite_bls
    WHERE id = ANY(p_granite_bl_ids)
      AND client_id IS NOT NULL
    LIMIT 1;
  END IF;

  -- Total de cobranças
  SELECT COALESCE(SUM(c.subtotal), 0)
  INTO v_total_brl
  FROM public.granite_bl_charges c
  WHERE c.bl_id = ANY(p_granite_bl_ids);

  v_bl_count := array_length(p_granite_bl_ids, 1);

  -- Criar invoice (invoice_number gerado automaticamente por trigger)
  INSERT INTO public.invoices (
    customer_id, issued_at, due_date, total_brl, status,
    notes, total_paid_brl, balance_brl, issued_by
  )
  VALUES (
    v_customer_id,
    now(),
    p_due_date,
    v_total_brl,
    'issued',
    NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    0,
    v_total_brl,
    p_actor
  )
  RETURNING id, invoice_number
  INTO v_invoice_id, v_invoice_number;

  -- Vincular B/Ls Granito
  INSERT INTO public.invoice_granite_bls (invoice_id, granite_bl_id, subtotal_brl)
  SELECT
    v_invoice_id,
    gb.id,
    COALESCE(charges.total, 0)
  FROM public.granite_bls gb
  LEFT JOIN (
    SELECT bl_id, SUM(subtotal) AS total
    FROM public.granite_bl_charges
    WHERE bl_id = ANY(p_granite_bl_ids)
    GROUP BY bl_id
  ) charges ON charges.bl_id = gb.id
  WHERE gb.id = ANY(p_granite_bl_ids);

  -- Inserir itens da invoice a partir das cobranças Granito
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_value_brl, total_value_brl)
  SELECT
    v_invoice_id,
    CONCAT('Granito BL ', gb.bl_number, ' - ', COALESCE(c.description, 'Taxa')),
    COALESCE(c.quantity, 1),
    COALESCE(c.unit_value, 0),
    COALESCE(c.subtotal, 0)
  FROM public.granite_bl_charges c
  JOIN public.granite_bls gb ON gb.id = c.bl_id
  WHERE c.bl_id = ANY(p_granite_bl_ids)
    AND COALESCE(c.subtotal, 0) > 0;

  -- Marcar BLs como faturados
  UPDATE public.granite_bls
  SET charge_status = 'invoiced'
  WHERE id = ANY(p_granite_bl_ids);

  RETURN jsonb_build_object(
    'invoice_id',     v_invoice_id,
    'invoice_number', v_invoice_number,
    'total_brl',      v_total_brl::TEXT,
    'bl_count',       v_bl_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_invoice_from_granite_bls(UUID[], BIGINT, DATE, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_invoice_from_granite_bls(UUID[], BIGINT, DATE, TEXT, UUID) TO authenticated;
