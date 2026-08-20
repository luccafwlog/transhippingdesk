# Relatório de verificação — escala com múltiplos terminais

Data: 2026-08-18  
Branch: `claude/escala-terminal-info-j1q7yu`  
PR: #550

## Implementação

As Tasks 1–8 do plano foram implementadas no branch da PR, incluindo a migration `306_escala_multiplos_terminais.sql`, o RPC transacional, a leitura/mutação por `report_id`, o modal de escala, ADR, impressão, timeline, Line-Up, Painel, TV e documentação de domínio. A aplicação efetiva da migration em um banco remoto não foi confirmada.

O modelo mantém ADRs legados sem terminal, usa terminal cadastrado vinculado ao porto, mantém `TBC` como estado de apresentação e trata a expectativa explícita de granito/vazios como fonte de frentes de exportação.

## Gates locais

| Gate | Resultado |
| --- | --- |
| Testes focados | Passaram |
| `npm run docs:check` | Passou |
| `npm run typecheck` | Passou |
| `npm run lint -- --quiet` | Passou |
| `npm test -- --run --maxWorkers=1` | 426 arquivos passaram; 3 ignorados; 2.027 testes passaram; 16 ignorados |
| `npm run build` | Passou |
| `git diff --check` | Passou |

## Evidência de segurança e compatibilidade

- Nenhum reset amplo ou execução de `supabase/scripts/reset_operational_data.sql` foi realizado.
- A migration preserva ADRs legados e registros dependentes de `report_id`.
- A reabertura terminalizada exige `public.is_admin()` e preserva sign-offs existentes.
- O RPC rejeita `export_expectation` nulo na fronteira SQL e bloqueia alterações que atinjam ADR fechado.

## Limitações

Não foi possível executar a matriz de integração em Postgres/Supabase descartável neste ambiente porque o runtime Docker/Postgres não está disponível. Portanto, a validação local comprova contratos textuais, tipos, testes de aplicação e build; não comprova aplicação efetiva da migration nem comportamento pós-deploy.

Também permanecem fora deste núcleo a revisão separada dos alertas de #519/#524 e a validação pós-deploy da PR.
