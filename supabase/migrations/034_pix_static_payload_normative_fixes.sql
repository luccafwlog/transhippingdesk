-- S08-C/F8: alinhar o payload estático Pix ao BR Code vigente.
-- O txid vive exclusivamente em 62-05; 26 é reservado ao Merchant Account
-- Information (GUI, chave Pix e extensões Pix autorizadas).

CREATE OR REPLACE FUNCTION public.build_transshipping_pix_payload(
  p_amount_brl numeric,
  p_txid text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key text := regexp_replace('06352972000121', '[^0-9]', '', 'g');
  v_merchant text := trim(regexp_replace(substring('TRANSHIPPING AGENCIAMENTO MARITIMO' FROM 1 FOR 25), '[^A-Za-z0-9 ]', '', 'g'));
  v_city text := trim(regexp_replace(substring('VIT' FROM 1 FOR 15), '[^A-Za-z0-9 ]', '', 'g'));
  v_txid text := coalesce(nullif(substring(regexp_replace(coalesce(p_txid, ''), '[^A-Za-z0-9]', '', 'g') FROM 1 FOR 25), ''), '***');
  v_amount_text text := CASE
    WHEN coalesce(p_amount_brl, 0) > 0 THEN to_char(round(p_amount_brl::numeric, 2), 'FM999999999999990.00')
    ELSE ''
  END;
  v_merchant_account text;
  v_payload text;
BEGIN
  IF v_amount_text <> '' AND (v_amount_text ~ '[#]' OR length(v_amount_text) > 13) THEN
    RAISE EXCEPTION 'Valor PIX excede o limite de 13 caracteres do campo BR Code 54.'
      USING ERRCODE = '22023';
  END IF;

  v_merchant_account :=
    public.pix_tlv('00', 'br.gov.bcb.pix') ||
    public.pix_tlv('01', v_key);

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

REVOKE ALL ON FUNCTION public.build_transshipping_pix_payload(numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.build_transshipping_pix_payload(numeric, text) TO service_role;
