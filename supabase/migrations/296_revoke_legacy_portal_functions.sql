-- 296: fecha o ACL das funções *_legacy deixadas pela 292.
--
-- Intenção: `ALTER FUNCTION ... RENAME TO` preserva o ACL. A 292 renomeou 13 RPCs
-- do Portal para `*_legacy` como rollback e revogou apenas os nomes que casam com
-- `portal_inspect_%` ou `_portal_%_core`; as `*_legacy` ficaram de fora e herdaram
-- o `GRANT ... TO anon, authenticated` vindo de 084/105/120/123. Nenhuma vaza dado
-- hoje — todas resolvem o cliente por current_portal_customer_id(), que é NULL
-- para anon — mas seguem publicadas em PostgREST, fora de teste e fora da
-- documentação. É o resíduo que vira vulnerabilidade quando alguém reaproveita a
-- função legada mais tarde. A 286 já aplicou esta mesma disciplina em
-- save_granite_bl_review_legacy_148.
--
-- Escopo: apenas grants. Nenhuma função é criada, alterada ou removida, e nenhuma
-- policy é tocada — a remoção definitiva fica para quando o rollback da 292 não
-- for mais necessário.
--
-- Afetados: nenhum consumidor. As *_legacy não são chamadas por src/, por Edge
-- Function nem por job. `service_role` é preservado de propósito, para que um
-- rollback manual pelo painel continue possível.
--
-- Rollback: GRANT EXECUTE ON FUNCTION public.<nome>(<args>) TO authenticated;
-- para a função específica que precisar voltar (nunca para `anon`).

DO $legacy$
DECLARE
  r RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE '%\_legacy'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.signature);
    v_count := v_count + 1;
    RAISE NOTICE 'ACL fechado: %', r.signature;
  END LOOP;

  -- Guarda de sanidade: a 292 deixou 13 funções *_legacy. Se a contagem cair a
  -- zero, o padrão de nome mudou e esta migration virou no-op silenciosa — falhar
  -- é melhor do que aplicar sem efeito e dar a impressão de que o ACL foi fechado.
  IF v_count = 0 THEN
    RAISE EXCEPTION 'Nenhuma função *_legacy encontrada em public; verifique o padrão de nome antes de aplicar.';
  END IF;
END;
$legacy$;
