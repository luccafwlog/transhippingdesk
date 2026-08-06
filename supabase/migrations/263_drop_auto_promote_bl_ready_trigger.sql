-- Etapa 3 do plano de faturamento (docs/plans/2026-08-06-faturamento-ajuste-completo.md,
-- ADR 0038 decisão 8): desliga a promoção automática de 'calculated' para
-- 'ready_for_billing'. Hoje o trigger promove qualquer B/L que fique com
-- charge_status='calculated' assim que o cliente já estiver reconciliado, sem
-- nenhuma confirmação explícita (CE Mercante ou clique manual) — o que faz
-- 'calculated' e 'ready_for_billing' virarem o mesmo estado na prática sempre
-- que a reconciliação já tiver acontecido antes do cálculo.
--
-- Com o trigger fora, 'calculated' volta a significar só "calculado e
-- conferível"; 'ready_for_billing' passa a ser produzido exclusivamente pelo
-- caminho explícito que já existia e continua existindo:
-- mark_bl_ready_for_billing (chamada direta na ficha do B/L, botão "Pronto
-- para faturar") e mark_bl_ready_and_create_invoice (usado por
-- markBlReadyAndCreateInvoice em src/services/billing.ts, por sua vez chamado
-- por tryAutoIssueInvoice/maybeAutoBillAfterCeMercante em
-- src/services/reviewBillingAutomation.ts após o CE Mercante). Nenhum desses
-- dois caminhos dependia do trigger — ambos já promovem explicitamente via
-- PERFORM/RPC própria — então remover o trigger não muda o resultado desses
-- fluxos, só para de promover silenciosamente os B/Ls calculados fora deles
-- (cálculo manual na ficha, recálculo em lote da Validação, cálculo
-- provisório no import da etapa 4).
--
-- Verificado antes de remover (docs/RASTREABILIDADE.md): nenhum outro
-- consumidor chama promote_calculated_bl_ready_for_billing() diretamente; a
-- função só existe como corpo do trigger. Removendo os dois.

DROP TRIGGER IF EXISTS trg_promote_calculated_bl_ready ON public.bls;
DROP FUNCTION IF EXISTS public.promote_calculated_bl_ready_for_billing();
