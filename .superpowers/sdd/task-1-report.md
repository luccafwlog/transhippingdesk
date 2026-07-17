# WS1 Task 1 - Alias de nome de navio

## Status

- Concluida.
- Escopo executado: helper compartilhado `canonicalizeVesselName` e teste dedicado, conforme `task-1-brief.md`.
- Escopo intencionalmente nao executado nesta tarefa: integrar o helper na validacao navio/viagem do Importar B/L.

## Commits

- `feat: add vessel name alias canonicalization`

## Resumo de testes

- RED: `npm test -- src/lib/__tests__/vesselAlias.test.ts`
  - falhou como esperado com `Cannot find module '../vesselAlias'`
- GREEN: `npm test -- src/lib/__tests__/vesselAlias.test.ts`
  - 1 arquivo, 5 testes passando
- Verificacao final:
  - `npm run docs:check` OK
  - `npm run lint` OK
  - `npm test` OK (`252 passed | 1 skipped` arquivos; `1067 passed | 9 skipped` testes)
  - `npm run build` OK

## Self-review

- Diff restrito a 2 arquivos novos em `src/lib` e ao relatorio pedido em `.superpowers/sdd`.
- O helper canonicaliza apenas aliases de prefixo completo, sem fuzzy matching nem expansao no meio do texto.
- O retorno permanece normalizado para comparacao, sem alterar nomes persistidos/exibidos por si so.
- `git diff --check` limpo nos arquivos da tarefa.

## Concerns

- A regra ainda nao esta conectada ao fluxo de validacao do Importar B/L; isso permanece para a Task 2 do brief.
