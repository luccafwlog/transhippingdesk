# Implementation Plans — Auditoria /improve 2026-07-07

Gerados pela skill improve (nível `standard`, todas as categorias exceto
segurança) em 2026-07-07, no commit `86cb5ac`. Segurança foi excluída porque a
auditoria deep de segurança do mesmo dia já tem planos próprios em
`docs/plans/security-audit-2026-07-07/`.

Seleção: a sessão rodou sem canal interativo de resposta, então este índice
registra o default da skill — planos para o top 5 por alavancagem
(impacto ÷ esforço, ponderado por confiança). Os demais achados verificados
estão listados ao final como backlog auditado, para não serem re-auditados.

Cada executor: leia o plano inteiro antes de começar, respeite as condições de
STOP e atualize sua linha na tabela ao terminar.

## Ordem de execução e status

| Plan | Título | Prioridade | Esforço | Depende de | Status |
|------|--------|------------|---------|------------|--------|
| 006 | **Executar primeiro:** consertar links quebrados que fazem `docs:check` falhar na main | P0 | S | — | TODO |
| 001 | Corrigir instrução stale de numeração de migrations (159→160) | P1 | S | 006 | TODO |
| 002 | Impedir fatura de Demurrage ativa duplicada por B/L (índice único + RPC) | P1 | M | 001 | TODO |
| 003 | Remover fallback estático de tarifas de Demurrage (alinhar ao CONTEXT.md) | P1 | M | — | TODO |
| 004 | Gravar `old_value` real na auditoria de devolução e flags Baplie | P2 | S | — | TODO |
| 005 | Adicionar script `typecheck` e gate `size-limit` no CI | P2 | S | — | TODO |

Status: TODO | IN PROGRESS | DONE | BLOCKED (com motivo em uma linha) |
REJECTED (com justificativa em uma linha).

## Notas de dependência

- 006 vem antes de todos: `npm run docs:check` sai com exit 1 na main (links
  relativos quebrados pelo commit `86cb5ac`, que moveu planos executados para
  `docs/archive/`), o que deixa vermelho o primeiro passo do CI de qualquer PR
  e impede os critérios de conclusão dos planos 001–005 (todos exigem
  `docs:check` verde). Achado descoberto durante a própria escrita destes
  planos.
- 002 depende de 001 porque 002 cria a migration `169_…` e 001 corrige as
  instruções de numeração que, seguidas à risca hoje, mandariam criar `160_`
  (colisão com migration existente). Se 001 ainda não tiver sido executado,
  o executor de 002 deve apenas ignorar o número stale citado nos docs e usar
  o próximo número real (`169_` se nada mudou).
- 003, 004 e 005 são independentes entre si e de 001/002.

## Backlog auditado (verificado, sem plano nesta rodada)

Achados confirmados com evidência, adiados por decisão de escopo (top 5):

- **N+1 nas importações** — `src/services/ceMercanteImport.ts:114-142` (1 RPC
  por linha) e `src/services/baplieReconciliation.ts:188-210` (2 writes por
  container em loop). Perf, esforço M.
- **Over-fetch do query `['voyages']`** — `src/hooks/useBls.ts:341-385` busca o
  grafo aninhado completo (BLs + containers + breakbulk) de até 500 viagens
  para exibir contagens em `src/services/voyageSummaries.ts`. Perf, esforço M.
- **Casts `as never` nas RPCs financeiras** — `src/services/billing.ts:604,743,770`,
  `src/services/billingLedger.ts:81-96`, `src/services/demurrage/demurrageInvoices.ts:79-90`
  (12 sites). Regenerar tipos das Functions e remover os casts. Debt, esforço M.
- **`src/services/charges/chargeOperationsService.ts` (626 linhas) sem teste** —
  só `chargeRateService` tem teste no diretório. Testes de caracterização antes
  de qualquer refactor. Tests, esforço M.
- **`Clientes.tsx`/`Demurrage.tsx` (~980 linhas) sem teste de página** —
  pré-requisito da decomposição que o `docs/ROADMAP.md` pede. Tests, esforço M–L.
- **`createInvoiceForBL` não impõe "todos os containers devolvidos"**
  (CONTEXT.md, Invoice de Demurrage) e a semântica de `demurrage_status =
  'overdue'` diverge entre `demurrageContainers.ts:42-44` (comentário: "ainda
  fora") e `:84` (setter marca devolvido-com-atraso). Investigar antes de
  corrigir — confiança MED.
- **Sentry importado estaticamente no bundle inicial** — `src/lib/telemetry.ts:4`
  via `src/main.tsx`. Avaliar import dinâmico pós-boot. Perf, esforço S–M.
- **`npm ci --legacy-peer-deps` universal** mascara conflito de peer deps não
  resolvido (README, WORKFLOW, CI). Investigar qual conflito e removê-lo. DX, M.
- **Direção (opções de produto, exigem decisão do mantenedor):** relatório
  consolidado por viagem (backlog explícito do ROADMAP; primitivas em
  `voyageSummaries.ts` e `exports.ts` já existem); smoke E2E dos fluxos
  financeiros/Portal (risco "Alto" no próprio ROADMAP; `scripts/setup-local-pg.sh`
  e fixtures já existem); realtime no Line Up TV (hoje `refetchInterval: 30_000`
  em `LineUpTVDisplay.tsx:38`).

## Achados considerados e rejeitados (não re-auditar)

- **"breakbulkManifestParser.ts sem teste"** — falso: o parser é exercitado com
  fixtures reais via `parseBreakbulkManifestBuffer` em
  `src/services/__tests__/breakbulkFixtures.real.test.ts` e
  `breakbulkImport.test.ts`.
- **Vulnerabilidades de dependências** — `npm audit --omit=dev` retorna 0
  (verificado 2026-07-07).
- **Segurança em geral** — coberta pela auditoria deep do mesmo dia
  (`docs/plans/security-audit-2026-07-07/`); não duplicar.
- **ROE não congelado na emissão** — decisão documentada (ADR 0014), não é bug.
- **Formatter/Prettier ausente** — possível escolha deliberada do time (ESLint
  só); exigiria um commit de normalização grande. Não recomendado sem decisão
  explícita do mantenedor.
