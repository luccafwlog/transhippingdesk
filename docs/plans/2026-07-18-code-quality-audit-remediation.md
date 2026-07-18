# Code Quality Audit Remediation (2026-07-18) — Implementation Plan

> Plano vivo, não verdade corrente. A autoridade executável é o código. Base de
> decisão: auditoria estrutural
> [code-quality-audit-thermo-nuclear-2026-07-18](../archive/audits/code-quality-audit-thermo-nuclear-2026-07-18.md)
> (registro histórico, imutável). Este plano consolida as medidas previstas
> naquele relatório em fatias revisáveis e **carrega adiante** o item ainda em
> aberto do plano anterior
> ([2026-07-06, Slice 5](../archive/plans/2026-07-06-code-quality-audit-remediation.md)):
> decompor `Clientes.tsx` e `Demurrage.tsx`.

**Goal:** Fechar a dívida estrutural que a auditoria de 2026-07-18 confirmou
como remanescente — consolidação canônica incompleta (`PreviewBox`, formatação
de moeda), funções gigantes em serviços coesos e dois componentes-página
monolíticos — **sem alterar comportamento**. Ao contrário do plano anterior,
nenhuma fatia aqui muda comportamento: tudo é reestruturação behavior-preserving.

**Architecture:** Cada fatia move na direção declarada em
[`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) (`pages → hooks → services`, `lib/`
como utilitário puro, `components/ui` como primitivas). Nenhuma migration nem
mudança de schema. As fatias são independentes e podem ser mergeadas
separadamente; a ordem prioriza risco eliminado por esforço (barato → alto
valor).

**Tech Stack:** TypeScript, Vitest, React (TanStack Query), Supabase. Sem
migration.

**Fontes de verdade:** [`CONTEXT.md`](../../CONTEXT.md) ·
[`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) ·
[`docs/CONVENCOES.md`](../CONVENCOES.md) ·
[`docs/RASTREABILIDADE.md`](../RASTREABILIDADE.md) ·
[auditoria 2026-07-18](../archive/audits/code-quality-audit-thermo-nuclear-2026-07-18.md).

---

## Prioridades da auditoria

| # | Achado | Severidade | Fatia |
|---|--------|-----------|-------|
| B1 | `demurragePresentation.fmtBRL` reescreve à mão enquanto o irmão `fmtUSD` já delega ao canônico `formatBRL`/`formatUSD` | P1 | Slice 1 |
| B2 | `formatCountLabel` duplicado verbatim (`Clientes.tsx:994`, `ChargeTablesTab.tsx:710`) | P3 | Slice 1 |
| B3 | `ui/PreviewBox.tsx` canônico existe, mas 6 cópias locais o ignoram | P1 | Slice 2 |
| B4 | `listInvoiceDetails` (256 linhas) e `buildVoyageTimeline` (~285 linhas) — funções gigantes | P2 | Slice 3 |
| B5 | `Clientes.tsx` (996) e `Demurrage.tsx` (978) monolíticos — componente único de ~890/~900 linhas | P1 | Slice 4 |
| B6 | `ChargeTablesTab.tsx` (712) e `ValidacaoTab.tsx` (788) monolíticos | P2 | Slice 5 |

---

## Slice 1 — Consolidar formatação (B1, B2)

Maior risco eliminado por menor esforço; diff mínimo, behavior-preserving.

- [ ] **B1.** Em `src/services/demurrage/demurragePresentation.ts`, trocar o
  corpo à mão de `fmtBRL` por delegação ao canônico:
  `value == null ? '---' : formatBRL(value)` — espelhando o irmão `fmtUSD` que
  já delega a `formatUSD` (`src/lib/utils.ts`).
  - **verify:** testes de `demurragePresentation` verdes; nenhuma outra
    chamada de `fmtBRL` muda de contrato. Se a divergência de espaço
    (não-quebrável vs. comum) for intencional em algum ponto de impressão,
    documentar com `ponytail:` em vez de duplicar.
- [ ] **B2.** Mover `formatCountLabel` para `src/lib/utils.ts` e importar em
  `src/pages/Clientes.tsx` e `src/components/taxasLocais/ChargeTablesTab.tsx`;
  deletar as duas cópias locais.
  - **verify:** `npm run lint` + `npm test` verdes.

## Slice 2 — Rollout canônico de `PreviewBox` (B3)

Subtração líquida de código. Fecha a Slice 4 do plano de 2026-07-06, que criou o
canônico mas não migrou os chamadores.

- [ ] Estender `src/components/ui/PreviewBox.tsx` para aceitar
  `value: number | string` e uma prop opcional `decimals` (formatação só quando
  `value` é número), preservando as variantes `metric`/`surface`.
- [ ] Deletar as 6 cópias locais e importar do canônico:
  - `src/components/shared/ContainerDatesImportModal.tsx:145`
  - `src/components/shared/CeMercanteImportModal.tsx:330`
  - `src/components/shared/BlImportModal.tsx:304`
  - `src/pages/CargaSolta.tsx:585`
  - `src/pages/Granite.tsx:467` (usa `decimals`)
  - `src/pages/Veiculos.tsx:521` (usa `value: number | string`)
  - **verify:** teste unitário do `PreviewBox` cobrindo número, string e
    `decimals`; `npm run build` verde; grep confirma zero definições locais
    remanescentes de `PreviewBox`.

## Slice 3 — Quebrar funções gigantes (B4)

Refactor puro dentro do arquivo; não move de camada.

- [ ] `src/services/billing.ts` — extrair as sub-etapas de `listInvoiceDetails`
  (`:433`→`:689`) em funções puras nomeadas (por seção do detalhe da fatura).
- [ ] `src/services/voyageSummaries.ts` — extrair as sub-etapas de
  `buildVoyageTimeline` (`:455`→~`:740`), naturalmente por tipo de evento da
  timeline.
  - **verify:** testes existentes de `billing` e `voyageSummaries` verdes antes
    e depois (behavior-preserving); nenhuma assinatura pública muda.

## Slice 4 — Decompor páginas monolíticas (B5)

Maior esforço, maior retorno. Fazer junto da próxima feature que tocar cada
página, se possível. Modelo de referência: `src/pages/Baplie.tsx` (container +
subcomponentes focados) e a decomposição já feita de `Manifestos.tsx`
(1089 → 514).

- [ ] `src/pages/Clientes.tsx` (996): extrair `CustomerTable`,
  `CreateCustomerModal` (dono do `ContactForm`) e `ImportBaseModal` para
  `src/components/` (ao lado dos pares existentes). `Clientes()` restante = só
  composição + estado de tela.
- [ ] `src/pages/Demurrage.tsx` (978): extrair um componente por aba
  (`containers` / status de fatura / `clientes`) e um modal por fluxo
  (`DiscountModal`, `DisputeModal`, `PtaxModal`, pagamento, relatório por
  cliente) para `src/components/demurrage/`; serviços correlatos para
  `src/services/demurrage/`.
  - **verify (cada):** behavior tests da página verdes; arquivo resultante bem
    abaixo de 1k linhas; `docs/RASTREABILIDADE.md` e o doc de módulo afetado
    atualizados na mesma mudança (contrato de documentação, `CLAUDE.md` §6).

## Slice 5 — Decompor abas monolíticas (B6)

Menor prioridade; incremental. Não bloqueia as fatias acima.

- [ ] `src/components/taxasLocais/ChargeTablesTab.tsx` (712, componente único
  `:29`→`:710`): extrair a(s) tabela(s) e blocos de formulário em
  subcomponentes.
- [ ] `src/components/billing/ValidacaoTab.tsx` (788, corpo `:37`→`:679`):
  idem.
  - **verify:** behavior tests verdes; arquivos claramente menores.

---

## Gates de verificação (antes de fechar cada slice)

- [ ] `npm run docs:check`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`

## Fora de escopo / notas

- **Sem migration:** nenhuma fatia toca schema.
- **Comportamento preservado:** todas as fatias são behavior-preserving — não há
  correção de bug embutida (diferente do plano de 2026-07-06). Os testes
  existentes devem permanecer verdes antes e depois.
- **Documentação viva:** as Slices 4 e 5 movem código entre arquivos/camadas —
  atualizar `docs/RASTREABILIDADE.md` e o doc de módulo afetado na mesma
  mudança.
- **Higiene de base (não requer ação):** a auditoria confirmou 0 `as any`,
  0 `TODO`/`FIXME` reais e apenas 7 `eslint-disable`. As findings de tipo/
  orquestração opcionais do plano anterior (Slice 6: `select` centralizado,
  `queryKeys.ts`, `ponytail:` em `useContainers`) seguem opcionais e fora do
  escopo desta rodada.
