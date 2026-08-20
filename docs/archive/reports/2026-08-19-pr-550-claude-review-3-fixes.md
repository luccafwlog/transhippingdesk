# PR 550 — tratamento da revisão complementar do Claude Code

## Escopo

Tratamento da revisão complementar da PR 550 após a rodada anterior de
correções da escala com múltiplos terminais.

## Tratado nesta rodada

- ADRs terminalizados resolvem nomes de sign-off, ocorrências e fechamento por
  `report_id`; o resolver e a reabertura legados ficam restritos ao ADR sem
  terminal.
- O modal de escala preserva os campos digitados quando o carregamento
  assíncrono de frentes e terminais termina.
- A aba do ADR bloqueia leitura e mutações enquanto o estado terminalizado está
  carregando ou indisponível; não há fallback inseguro para o RPC legado.
- O recálculo transacional do status da viagem ignora PODs omitidos e PODs
  removidos por soft-delete.
- A retirada de exportação continua protegida por carga vinculada, mas os
  bloqueios de granito e vazios são independentes.
- O terminal voltou a ser editável no ADR legado sem frente atribuída; ADR
  terminalizado continua derivando o terminal da alocação.
- A célula vazia do Line-Up acompanha as 15 colunas atuais.

## Evidência

Os testes focados desta rodada passaram: 4 arquivos e 88 testes. A suíte
integral serial passou com 427 arquivos, 2.059 testes e 3 arquivos/16 testes
pulados. Os gates de typecheck, lint, build, documentação e orçamento de
bundle foram executados no commit desta rodada. O contrato SQL da migration
306 foi validado por teste textual automatizado; não houve replay em Postgres
descartável nesta máquina porque WSL e Docker estão indisponíveis. A validação
de runtime, RLS e grants permanece dependente do ambiente Supabase.
