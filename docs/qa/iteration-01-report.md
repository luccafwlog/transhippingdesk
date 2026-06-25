# Iteração 1 — Relatório de validação contínua

Data: 2026-06-25. Branch: `claude/quirky-einstein-3van4s`.

## 1. Resumo de cobertura

- **Features catalogadas:** 45 (F-001..F-045) em
  [`feature-spreadsheet.csv`](./feature-spreadsheet.csv), cobrindo as 38 rotas de
  `src/App.tsx` (incluindo redirects), 2 Edge Functions e processos
  transversais (recálculo diário de ROE).
- **Suite automatizada:** 183 arquivos de teste, 759 testes
  (750 pass, 9 skip) — `npm test`.
- **Gates do projeto:** `npm test`, `npm run lint`, `npm run docs:check`,
  `npm run build` — todos verdes.
- **Cobertura de testes por feature:** 43/45 features com pelo menos um teste
  automatizado direto ou de contrato. As exceções são F-044
  (`notify-invoice-issued`, inativa por decisão — WAIVED) e Edge Functions, que
  são mockadas e não executadas em runtime.

## 2. Features testadas

Todas as features do catálogo foram mapeadas a test cases existentes
(ver coluna *Test Cases* da planilha). A frente desta iteração concentrou a
execução e a busca de defeitos na área mais crítica em cálculo financeiro:
demurrage (F-031), por ser a matemática de maior impacto monetário.

## 3. Defeitos encontrados

| Defect ID | Feature | Severidade | Status |
|---|---|---|---|
| DEF-001 | F-031 Demurrage | High | Corrigido |

Detalhe completo em [`defects-log.md`](./defects-log.md).

DEF-001: `calculateDemurrage` contava a faixa P2 a partir do dia fixo do grupo,
incluindo dias ainda livres quando o `free_time_override` do B/L ultrapassava o
fim de P1 — sobrecobrança de demurrage na invoice emitida ao cliente. O caminho
afetado alimenta a geração dos itens da invoice em
[`demurrageInvoices.ts`](../../src/services/demurrage/demurrageInvoices.ts).

## 4. Defeitos corrigidos

- **DEF-001:** início de P2 passou a ser `max(p2_day_from, freeUntil+1)` em
  [`demurrageRates.ts`](../../src/services/demurrage/demurrageRates.ts). Teste de
  regressão adicionado; caso normal (override ≤ fim de P1) inalterado. Doc viva
  atualizada em [`../modules/demurrage.md`](../modules/demurrage.md).

## 5. Riscos remanescentes

- **Contratos SQL não executados contra banco:** 26 testes `*Migration.test.ts`
  são *Teste de contrato SQL* (detectam drift no SQL versionado, não provam
  RLS/grants em execução). Itens marcados **Suspeita** em
  [`../RASTREABILIDADE.md`](../RASTREABILIDADE.md) (ex.: grants `anon` em leituras
  do Portal; definers sem `is_active_user()`) exigem verificação remota
  autorizada e tocam migrations protegidas — fora do escopo de correção segura
  nesta iteração.
- **Edge Functions:** `provision-portal-user` e `notify-invoice-issued` são
  mockadas; não há execução de runtime nesta frente.
- **Runtime de UI:** páginas marcadas "runtime não executado" na rastreabilidade
  (Alertas, Perfil do Portal, Admin, Chegadas/Saídas) têm comportamento coberto
  por teste de unidade, mas não por navegação de browser nesta iteração.

## 6. Pontuação de confiança

**Confiança: 88%.**

Justificativa: suite ampla e verde (759 testes), todos os gates verdes, e um
defeito financeiro real encontrado e corrigido com regressão. O desconto vem dos
riscos remanescentes não verificáveis com segurança neste ambiente (contratos
SQL/RLS em runtime remoto, Edge Functions e validação de UI por browser).

## Critérios de saída — estado

- Toda feature identificável catalogada: **Sim** (45 features, 38 rotas).
- Toda feature com pelo menos um test case: **Sim** (exceto WAIVED F-044).
- Todo teste executado: **Sim** (`npm test`, 750 pass / 9 skip).
- Defeitos documentados: **Sim** (DEF-001).
- Defeitos críticos/altos abertos: **Não** (DEF-001 corrigido).
- Regressão sem falhas: **Sim**.

---

# Iteração 2 — Relatório

Data: 2026-06-25.

## 1. Resumo de cobertura

Suite após a iteração: 184 arquivos de teste, 765 testes (756 pass / 9 skip).
Gates verdes. Revisão dirigida (caça a defeitos) nas áreas de maior impacto
financeiro/integridade não cobertas na iteração 1.

## 2. Features revisadas em profundidade

- F-028/F-031 Conciliação PIX e janela das duas PTAX
  (`reconciliacao.ts`) — lógica de match por TXID/valor e janela de recálculo
  conferida; **sem defeito**.
- F-020/F-031 Desconto de demurrage e congelamento de BRL
  (`demurrageInvoices.ts`) — ver item 4.
- Validação financeira (`financialValidation.ts`): parsing BR de número,
  validação de data (UTC round-trip), cap de percentual — **sem defeito**.
- Status de demurrage corrente (`containerDatesImport.ts`) — **sem defeito**;
  beneficiado pela correção DEF-001.
- Lógica pura de dependências de exclusão (`deleteDependencies.ts`) e
  `portCode.ts` — **sem defeito**.

## 3. Defeitos encontrados — 0 novos defeitos funcionais

## 4. Hardening aplicado (risco de integridade)

- **HARD-001:** o cálculo do desconto em USD da fatura de demurrage estava
  **duplicado** em dois caminhos (`markInvoicePaid` e `recomputeDiscountedBrl`)
  de [`demurrageInvoices.ts`](../../src/services/demurrage/demurrageInvoices.ts).
  Cópias que precisam ficar em sincronia são risco de divergência do valor
  faturado. Consolidado em uma fonte única `applyDemurrageUsdDiscount`, com teste
  dedicado (`applyDemurrageUsdDiscount.test.ts`). Comportamento idêntico ao
  anterior (sem mudança de valor).

## 5. Riscos remanescentes

Iguais aos da iteração 1 (contratos SQL/RLS não executados em runtime remoto,
Edge Functions mockadas, validação de UI por browser não executada). Nenhum
novo risco introduzido.

## 6. Pontuação de confiança

**Confiança: 90%** (+2). Revisão dirigida ampliou a área inspecionada sem
encontrar novos defeitos funcionais; consolidação de lógica financeira reduziu
risco de divergência. Desconto remanescente pelos mesmos limites de ambiente.
