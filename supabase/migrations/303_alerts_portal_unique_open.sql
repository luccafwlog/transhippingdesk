-- 303: A deduplicação dos alertas do Portal deixa de ser check-then-insert.
--
-- Problema: `openAlertOnce` (_shared/portalAlerts.ts) consulta se existe alerta
-- não fechado para o par (tipo, entidade) e, não havendo, insere. Entre a
-- consulta e o INSERT não há nada segurando a linha, e os dois chamadores são
-- justamente os que chegam em rajada: o webhook do Resend entrega um evento por
-- destinatário do mesmo envio, e o login bloqueado dispara a cada tentativa da
-- rajada que causou o bloqueio. O helper estreitava a janela; não a fechava. A
-- fila do operador continuava podendo receber o duplicado que ele existe para
-- evitar -- e duplicado em fila de alerta é pior que ruído, porque fechar um
-- deixa o outro aberto acusando um problema já resolvido.
--
-- Por que um índice parcial e não uma restrição em `alerts`: a tabela (001)
-- serve o sistema inteiro e outros tipos abrem legitimamente mais de um alerta
-- não fechado para a mesma entidade (fatura vencida por competência, por
-- exemplo). A unicidade vale só para os dois tipos que passam pelo helper.
--
-- O predicado repete o do helper (`status <> 'closed'`), e não `= 'open'`: um
-- alerta apenas reconhecido continua segurando o duplicado, porque o operador
-- já o viu e ainda não o resolveu. Alerta fechado não impede a abertura do
-- próximo -- o problema pode voltar, e voltando merece fila nova.
--
-- Os duplicados que já existem são fechados antes, mantendo o mais antigo de
-- cada par: é o que carrega o histórico e o `assigned_to` de quem o pegou.
--
-- Rollback: DROP INDEX public.uq_alerts_portal_aberto_por_entidade.

WITH duplicados AS (
  SELECT id, row_number() OVER (PARTITION BY type, entity_type, entity_id ORDER BY id) AS posicao
  FROM public.alerts
  WHERE status <> 'closed'
    AND type IN ('portal_abuso_login','portal_email_suprimido')
    AND entity_type IS NOT NULL
    AND entity_id IS NOT NULL
)
UPDATE public.alerts a
SET status = 'closed', closed_at = now()
FROM duplicados d
WHERE d.id = a.id AND d.posicao > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_portal_aberto_por_entidade
  ON public.alerts (type, entity_type, entity_id)
  WHERE status <> 'closed'
    AND type IN ('portal_abuso_login','portal_email_suprimido');

COMMENT ON INDEX public.uq_alerts_portal_aberto_por_entidade IS
  'Um alerta não fechado por (tipo, entidade) nos tipos abertos por openAlertOnce. O helper consulta antes como caminho rápido; a garantia é esta.';
