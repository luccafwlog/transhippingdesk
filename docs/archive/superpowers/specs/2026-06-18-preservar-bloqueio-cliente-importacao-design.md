# Preservar bloqueio de cliente na importação

## Problema

O faturamento automático ignora corretamente B/Ls sem cliente reconciliado. Porém, o pós-processamento da importação interpreta a ausência de linhas em `charge_calculations` como ausência de tabela e sobrescreve o motivo real.

## Desenho aprovado

- Remover da função `import_manifest_with_postprocess_transactional` a inferência genérica baseada apenas na ausência de linhas calculadas.
- Manter `run_billing_for_import_batch` responsável pelo bloqueio de cliente.
- Manter `calculate_bl_local_charges` e `resolve_local_charge_table_id` como responsáveis exclusivos por identificar ausência de tabela vigente.
- Não alterar o cálculo, o cadastro de tabelas ou a interface.

## Resultado esperado

Um B/L sem cliente mantém a pendência de reconciliação e não recebe a mensagem “Nenhuma tabela de preço”. Um B/L elegível cujo resolvedor não encontre tabela continua recebendo a pendência específica criada pelo cálculo.

## Verificação

Um teste de contrato da migração confirma que a função continua executando o billing, mas não contém a inferência `bls_without_charges` nem grava a mensagem genérica de ausência de tabela.
