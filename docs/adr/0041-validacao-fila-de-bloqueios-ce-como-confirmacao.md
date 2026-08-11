# 0041 — Validação como fila de bloqueios; CE Mercante como confirmação

Status: aceito — 2026-08-10

## Contexto

A aba Validação misturava estados internos de `charge_status` com um funil e
ações de aprovação/marcação em lote. O fluxo automático já calcula o B/L e usa o
cadastro do CE Mercante para confirmar e emitir, portanto esses atos não eram
uma confirmação operacional confiável. Falhas de emissão também ficavam apenas
em telemetria.

## Decisão

1. `/faturamento` é uma fila derivada de três bloqueios: Sem cliente vinculado,
   Cálculo incompleto e Aguardando CE Mercante. Faturado e Isento ficam fora por
   padrão e retornam pelo filtro de resolvidos.
2. O cadastro do CE Mercante é o ato de confirmação do cálculo. A Validação
   oferece desbloqueio por recálculo, reconciliação e emissão individual, sem
   aprovação ou marcação em lote.
3. Falhas de emissão automática criam um alerta `billing_auto_issue_failed`
   para o B/L, sem transformar espera normal (cliente, cálculo ou CE) em alerta.
4. A conferência provisória é exportada em XLSX e a emissão operacional por
   linha usa o workflow que preserva o caminho de Granito.

## Consequências

`charge_status` continua no banco e nas demais superfícies, mas deixa de ser o
modelo visual da fila. A RPC e as ações por B/L permanecem disponíveis. O lote
de aprovação/marcação sai da tela; o lote de recálculo continua limitado à
seleção do operador.

## Alternativas consideradas

**Nota editorial — 2026-08-10:** a decisão 2 continua valendo; a marcação manual de "pronto para faturar" de **Granito** permanece na tela como ponte até que o CE de Granito exista, pois `create_invoice_from_granite_bls` exige `charge_status = 'ready_for_billing'`. A fila também expõe `pronto` fora da vista padrão.

- Manter o funil e expor `charge_status`: rejeitado, pois o campo é detalhe do
  motor e não representa o bloqueio que o operador precisa resolver.
- Criar uma tabela de falhas: rejeitado; `alerts` já é a superfície operacional
  existente e aceita o tipo livre sem migration.
