-- 371: a importacao volta a capturar o contato do manifesto (regressao).
--
-- A captura na importacao foi projetada e existe desde a 101, refeita na 149 e
-- na 165: `import_manifest_with_postprocess_transactional` recebe
-- `p_contact_emails` e insere em `customer_contacts` com a regra
-- 'Contato manifesto' / purpose 'financeiro' / sem duplicar. O que aconteceu e
-- que o aplicativo deixou de chamar essa funcao: hoje a importacao entra por
-- `import_bl_freight_transactional` (documento do B/L) e por
-- `import_breakbulk_manifest_transactional`, e nenhuma das duas captura. A
-- funcao antiga segue no banco, sem chamador.
--
-- O efeito e silencioso e caro: `notify-invoice-issued` procura contatos do
-- cliente e, sem nenhum, devolve `skipped: 'no recipient emails'` — a fatura e
-- emitida e o aviso nao sai. Como o vinculo por CNPJ (`matched_document`)
-- fecha a fila sozinho, ninguem abre a Revisao para esse B/L e nao ha segunda
-- chance de registrar o contato. Dois B/Ls identicos passam a ter destinos
-- diferentes conforme o CNPJ do manifesto bateu ou nao — criterio invisivel
-- para quem opera.
--
-- A captura entra em `apply_bl_review_gate_after_import`, que e o pos-import
-- comum aos dois caminhos vivos (o de documento chama pelo corpo legacy_357; o
-- breakbulk chama direto). Um lugar so, e nao uma copia por RPC de importacao.
-- A regra em si continua sendo a funcao unica da 370, a mesma que a Revisao e o
-- Aprovar da Validacao usam.
--
-- Nao captura para carga solta hoje porque o layout de planilha aceito pelo
-- parser de breakbulk nao tem coluna de e-mail: nao ha valor a perder ali. Se o
-- layout ganhar a coluna, esta captura passa a valer sem mudanca nenhuma aqui.
--
-- Escopo preservado: o gate canonico, os alertas, a auditoria e a sincronizacao
-- da fila seguem identicos aos da 129; a funcao so ganha a captura no inicio.
--
-- Rollback: reaplicar `apply_bl_review_gate_after_import` da migration 129.

CREATE OR REPLACE FUNCTION public.apply_bl_review_gate_after_import(
  p_bl_ids TEXT[],
  p_changed_by UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bl RECORD;
  v_reason TEXT;
  v_reasons TEXT[];
  v_notes TEXT;
  v_changed INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para aplicar gate de importacao.'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(cardinality(p_bl_ids), 0) = 0 THEN
    RETURN 0;
  END IF;

  -- Captura do contato do manifesto na importacao. A regra e a mesma funcao
  -- unica da 370, chamada tambem pela Revisao e pelo Aprovar da Validacao.
  --
  -- Roda ANTES do laco de pendencias, e nao dentro dele, porque o laco faz
  -- CONTINUE quando o B/L nao tem pendencia nenhuma — que e exatamente o caso
  -- do B/L auto-vinculado por CNPJ (`matched_document`), o que mais precisa
  -- desta captura: ninguem abre a Revisao para ele, entao esta e a unica
  -- oportunidade de registrar o contato.
  --
  -- DISTINCT porque um manifesto traz varios B/Ls do mesmo cliente com o mesmo
  -- e-mail: sem ele, as chamadas da mesma instrucao nao enxergam a linha que a
  -- anterior acabou de inserir e o NOT EXISTS interno deixaria passar duplicata.
  PERFORM public.capture_manifest_financial_contact(alvo.customer_id, alvo.email)
  FROM (
    SELECT DISTINCT b.customer_id, lower(btrim(b.manifest_customer_email)) AS email
    FROM public.bls AS b
    WHERE b.id = ANY(p_bl_ids)
      AND b.customer_id IS NOT NULL
      AND NULLIF(btrim(COALESCE(b.manifest_customer_email, '')), '') IS NOT NULL
  ) AS alvo;

  FOR v_bl IN
    SELECT b.id, b.review_status, b.notes, b.financial_status
    FROM public.bls b
    WHERE b.id = ANY(p_bl_ids)
    ORDER BY b.id
  LOOP
    IF v_bl.financial_status = 'invoiced'
       OR EXISTS (
         SELECT 1
         FROM public.invoice_bls ib
         JOIN public.invoices i ON i.id = ib.invoice_id
         WHERE ib.bl_id = v_bl.id
           AND i.status NOT IN ('cancelled', 'obsolete')
       ) THEN
      CONTINUE;
    END IF;

    v_reasons := public.compute_bl_review_pendencies(v_bl.id);
    IF COALESCE(cardinality(v_reasons), 0) = 0 THEN
      CONTINUE;
    END IF;

    v_notes := v_bl.notes;
    FOREACH v_reason IN ARRAY v_reasons
    LOOP
      IF COALESCE(v_notes, '') NOT ILIKE '%' || v_reason || '%' THEN
        IF COALESCE(v_notes, '') ILIKE '%Pendencias de importacao:%' THEN
          v_notes := v_notes || ', ' || v_reason;
        ELSE
          v_notes := concat_ws(
            E'\n',
            NULLIF(btrim(COALESCE(v_notes, '')), ''),
            'Pendencias de importacao: ' || v_reason
          );
        END IF;
      END IF;
    END LOOP;

    UPDATE public.bls
    SET
      review_status = 'pending_review',
      notes = v_notes
    WHERE id = v_bl.id;

    IF v_bl.review_status IS DISTINCT FROM 'pending_review' THEN
      INSERT INTO public.audit_logs (
        entity_type,
        entity_id,
        field_name,
        old_value,
        new_value,
        changed_by,
        justification
      )
      VALUES (
        'bl',
        v_bl.id,
        'review_status',
        v_bl.review_status,
        'pending_review',
        p_changed_by,
        'Gate canonico aplicado apos importacao'
      );
    END IF;

    PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl.id);
    v_changed := v_changed + 1;
  END LOOP;

  RETURN v_changed;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_bl_review_gate_after_import(TEXT[], UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_bl_review_gate_after_import(TEXT[], UUID) TO authenticated;
