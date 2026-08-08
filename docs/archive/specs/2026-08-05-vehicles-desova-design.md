# Veículos: local de desova e consolidação no ADR

## Objetivo

Permitir informar e filtrar o local de desova dos veículos na tela de Veículos,
aplicar o valor a todos os registros selecionados pelo filtro, importar o valor
pela planilha já aceita e exibir no ADR os totais por tipo de container e modelo.

## Decisões

- `unpacking_location` pertence ao container; cada veículo continua vinculado a
  um único container.
- O checkbox do cabeçalho representa todos os veículos do conjunto filtrado da
  viagem, não apenas a página carregada.
- A mutação em massa deduplica os containers antes de gravar.
- A coluna de planilha é opcional para manter compatibilidade com arquivos
  antigos.
- O ADR conta containers distintos por tipo e veículos distintos por modelo.

## Escopo técnico

Atualizar consulta/opções de Veículos, seleção global e mutações; completar o
parser e a RPC transacional; adicionar testes de parser, filtros, seleção e
agregações; e atualizar a apresentação da seção de Veículos no ADR.
