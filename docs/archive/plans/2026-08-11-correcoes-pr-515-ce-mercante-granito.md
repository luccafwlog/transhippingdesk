# Plano corretivo — PR #515 (CE Mercante em Granito)

> Plano recebido como texto colado em 2026-08-11. Arquivado após a execução na
> branch `codex/ce-mercante-granito`.

## Resultado

- F1: resolução de `bl_number` para a PK UUID de `granite_bls`, filtrada pela
  viagem selecionada, com erros de inexistência e ambiguidade por linha.
- F2: fila e tabela usam `ce_mercante` persistido; Granito com CE fica pronto
  e oferece emissão individual, enquanto Granito sem CE aguarda o documento.
- F3: workflow protege B/L faturado, registra no-op e restaura o status anterior
  quando a emissão falha.
- F4: EDI linha-a-linha invalida caches e informa o resultado parcial.
- F5/F6: RPC `281_granite_ce_mercante_audit_rpc.sql` audita a escrita e devolve
  `inserted`, `overwritten` ou `unchanged`; os contadores usam o discriminador.
- F7: os ramos duplicados de `Granite.tsx` permanecem colapsados em um fluxo
  único.

## Evidências

- Testes focados de importação, workflow, migration, modal e fila passaram.
- `npm run lint`, `npm run build`, `npm run docs:check`, `npx tsc -b --pretty false`
  e `git diff --check` passaram.
- A suíte completa teve uma falha isolada por timeout em
  `src/pages/__tests__/Demurrage.behavior.test.tsx`; 380 arquivos passaram.
