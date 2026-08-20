# Correções da revisão da PR 550

## Objetivo

Fechar os achados acionáveis da revisão da PR #550 sem perder a compatibilidade
com ADRs legados, terminais sem mapeamento e perfis internos existentes.

## Escopo executado

- [x] Corrigir o cadastro de terminal: porto brasileiro obrigatório para novos
  registros, preflight visível do legado e preservação de linhas antigas.
- [x] Preservar frentes/IDs persistidos na projeção e marcar exportações
  declaradas como dados reais da frente.
- [x] Exibir cabeçalho de escala sempre e filtrar o conteúdo do ADR por frente
  atribuída ao terminal selecionado.
- [x] Restringir fechamento/remoção de alertas por `report_id`, excluir eventos
  de ciclo de vida da guarda de remoção e indexar referências de auditoria.
- [x] Recuperar a declaração legada de vazios, alinhar query keys e invalidar
  o estado terminalizado real.
- [x] Preservar permissões de perfis ativos para exportação sem liberar edição
  de terminais; remover a releitura interna da revisão.
- [x] Tornar a gravação terminalizada de datas do POD parte da mesma RPC,
  corrigir deep-link do ADR, auditoria por código/departamento e chunking.
- [x] Atualizar testes, documentação viva, changelog e descrição da PR.

## Verificação

- Testes focados e suíte completa da PR.
- `npm run typecheck`, `npm run lint`, `npm run build` e `npm run docs:check`.
- Migration 306 reaplicada em Postgres local descartável; trigger de terminal
  novo sem porto e edição de terminal legado validados em transação rollback.
