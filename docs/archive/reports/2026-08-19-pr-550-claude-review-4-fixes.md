# PR 550 — tratamento da revisão final do Claude Code

Data: 2026-08-19  
Escopo: `claude/escala-terminal-info-j1q7yu` / PR 550  
Base revisada: `41e44da`

## Resultado

A revisão identificou que o catálogo `public.ports` do projeto de produção está
vazio, enquanto a migration 306 passa a exigir esse catálogo para salvar uma
escala terminalizada. A produção ainda está na migration 305 porque a PR não foi
mergeada; portanto, a correção foi feita como migration aditiva 307, aplicada
logicamente após a 306 no merge.

Também foram corrigidos o ciclo assíncrono do modal de escala, a hidratação dos
drafts de terminais, o reset ao reabrir a mesma escala, o bloqueio de save durante
loading/erro, a paginação das fontes derivadas, a guarda de auditoria sem `ILIKE`
no lock da escala e a permissão visual do Terminal em ADR legado.

## Evidências

- **Runtime:** `public.ports` tinha zero linhas no projeto Supabase de produção;
  as migrations registradas chegavam à versão 305.
- **Código:** migration 307 insere dez LOCODEs brasileiros canônicos de forma
  idempotente e normaliza o alias legado `BRVIT` para `BRVIX` quando necessário.
- **Teste:** 4 arquivos focados, 97 testes aprovados.
- **Teste de contrato SQL:** migration 306 e migration 307 cobrem a dependência
  do catálogo, a guarda indexável de auditoria e os contratos de RPC.

O seed de validação continua separado: a migration 307 é o catálogo operacional
necessário ao ambiente implantado, não um seed de fixture.
