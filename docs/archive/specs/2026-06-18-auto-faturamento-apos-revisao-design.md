# Auto-faturamento após revisão

## Problema

O vínculo inline de cliente executa o fluxo completo de faturamento, mas o modal de revisão apenas salva o cliente e encerra. O B/L pode então ser marcado como pronto sem linhas de cobrança, causando falha na emissão e deixando-o preso em Validação.

## Desenho aprovado

- Após salvar um B/L comum pelo modal, quando houver cliente selecionado, executar `tryAutoIssueInvoice`.
- Manter o comportamento atual para Granito.
- Mostrar ao operador se a fatura foi emitida ou qual bloqueio permaneceu.
- Reforçar `mark_bl_ready_for_billing` para rejeitar B/L sem linhas BRL positivas elegíveis.
- Recalcular e faturar o B/L afetado após a correção entrar no banco.

## Resultado esperado

Corrigir a pendência de cliente pelo modal recalcula as taxas e emite automaticamente a fatura quando não houver outro bloqueio. Nenhuma rota poderá colocar um B/L sem valor faturável em `ready_for_billing`.

## Testes

- Teste de componente confirma que salvar o modal chama a automação.
- Teste de contrato SQL confirma que a migração exige linha BRL positiva antes de marcar o B/L como pronto.
