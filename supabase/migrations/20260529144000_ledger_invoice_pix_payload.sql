-- Generate local-charge invoice PIX payloads inside the database so automatic
-- individual emission and direct consolidated RPC calls do not depend on a
-- frontend/lazy-read path to create the QR Code payload.

CREATE OR REPLACE FUNCTION public.pix_tlv(p_id TEXT, p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
  SELECT p_id || LPAD(LENGTH(p_value)::TEXT, 2, '0') || p_value
$$;

CREATE OR REPLACE FUNCTION public.pix_crc16_ccitt(p_payload TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_crc INTEGER := 65535;
  v_byte INTEGER;
  v_index INTEGER;
  v_bit INTEGER;
BEGIN
  FOR v_index IN 1..LENGTH(p_payload) LOOP
    v_byte := GET_BYTE(CONVERT_TO(SUBSTRING(p_payload FROM v_index FOR 1), 'UTF8'), 0);
    v_crc := v_crc # (v_byte << 8);

    FOR v_bit IN 1..8 LOOP
      IF (v_crc & 32768) <> 0 THEN
        v_crc := ((v_crc << 1) # 4129) & 65535;
      ELSE
        v_crc := (v_crc << 1) & 65535;
      END IF;
    END LOOP;
  END LOOP;

  RETURN UPPER(LPAD(TO_HEX(v_crc & 65535), 4, '0'));
END;
$$;

CREATE OR REPLACE FUNCTION public.build_transshipping_pix_payload(
  p_amount_brl NUMERIC,
  p_txid TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key TEXT := REGEXP_REPLACE('06352972000121', '[^0-9]', '', 'g');
  v_merchant TEXT := TRIM(REGEXP_REPLACE(SUBSTRING('TRANSHIPPING AGENCIAMENTO MARITIMO' FROM 1 FOR 25), '[^A-Za-z0-9 ]', '', 'g'));
  v_city TEXT := TRIM(REGEXP_REPLACE(SUBSTRING('VIT' FROM 1 FOR 15), '[^A-Za-z0-9 ]', '', 'g'));
  v_txid TEXT := COALESCE(NULLIF(SUBSTRING(REGEXP_REPLACE(COALESCE(p_txid, ''), '[^A-Za-z0-9]', '', 'g') FROM 1 FOR 35), ''), '***');
  v_amount_text TEXT := CASE
    WHEN COALESCE(p_amount_brl, 0) > 0 THEN TO_CHAR(ROUND(p_amount_brl::NUMERIC, 2), 'FM999999999999990.00')
    ELSE ''
  END;
  v_merchant_account TEXT;
  v_payload TEXT;
BEGIN
  v_merchant_account :=
    public.pix_tlv('00', 'br.gov.bcb.pix') ||
    public.pix_tlv('01', v_key) ||
    public.pix_tlv('05', v_txid);

  v_payload :=
    public.pix_tlv('00', '01') ||
    public.pix_tlv('26', v_merchant_account) ||
    public.pix_tlv('52', '0000') ||
    public.pix_tlv('53', '986') ||
    CASE WHEN v_amount_text <> '' THEN public.pix_tlv('54', v_amount_text) ELSE '' END ||
    public.pix_tlv('58', 'BR') ||
    public.pix_tlv('59', v_merchant) ||
    public.pix_tlv('60', v_city) ||
    public.pix_tlv('62', public.pix_tlv('05', v_txid)) ||
    '6304';

  RETURN v_payload || public.pix_crc16_ccitt(v_payload);
END;
$$;

CREATE OR REPLACE FUNCTION public.populate_local_invoice_pix_payload()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.pix_payload IS NULL
     AND COALESCE(NEW.invoice_type, 'individual') IN ('individual', 'consolidated')
     AND NULLIF(TRIM(COALESCE(NEW.invoice_number, '')), '') IS NOT NULL
     AND COALESCE(NEW.total_brl, 0) > 0 THEN
    NEW.pix_payload := public.build_transshipping_pix_payload(NEW.total_brl, NEW.invoice_number);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_populate_local_invoice_pix_payload ON public.invoices;
CREATE TRIGGER trg_populate_local_invoice_pix_payload
BEFORE INSERT OR UPDATE OF invoice_number, total_brl, invoice_type, pix_payload
ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.populate_local_invoice_pix_payload();
