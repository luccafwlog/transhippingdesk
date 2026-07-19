# WS4 — Câmbio PTAX/ROE, Portal Demurrage e limpezas de legado (spec §7, §9, §11, §14, §15) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Header interno mostra PTAX Venda × 1,065 = ROE com data efetiva (CNY removido), consumindo a mesma fonte autoritativa do recálculo de demurrage; Portal exibe apenas o ROE vigente na aba Demurrage via referência persistida no servidor; remoção integral do backfill do Portal e do importador IMO/OOG; reorganização/renomeação da aba Importação; confirmações de exclusão universais.

**Architecture:** `fetchROE` (`src/services/demurrage/demurrageKpis.ts`) é a fonte autoritativa — ela é estendida para expor também `ptax` e `effectiveDate`, e passa a persistir a cotação numa tabela nova `exchange_rate_reference` (referência lida pelo Portal via RPC, pois o Portal não consulta BCB nem deriva ROE no navegador). `useExchangeRates` é substituído por `useRoeHeaderRate` que delega a `fetchROE`. Remoções (backfill, IMO/OOG) são deleção de UI + serviços + RPCs por migration.

**Tech Stack:** React + TypeScript, Vitest, Supabase, BCB Olinda PTAX (já usado por `fetchROE` com `AbortSignal.timeout(12000)` e cache local).

**Fontes obrigatórias:** spec §7, §9, §11, §14, §15; `docs/modules/demurrage.md`; `docs/modules/operacao-suporte.md`; `docs/adr/0014`; `src/services/demurrage/demurrageKpis.ts` (linhas 254–282); skills `react-query-pattern` e `supabase-migration`.

**Dependências:** A Task 6 (aba Importação) remove a entrada `cntr` de `VoyageImportActions.tsx` — coordene com WS1 Task 8 (quem rodar primeiro remove; o segundo só confere).

---

### Task 1: `fetchROE` expõe PTAX e data efetiva

**Files:**
- Modify: `src/services/demurrage/demurrageKpis.ts` — `FetchROEResult` (linha 254) e `fetchROE` (linha 256)
- Test: `src/services/__tests__/fetchROE.test.ts` (existente)

- [ ] **Step 1: Write the failing test** — no padrão de mock de `fetch` do teste existente, asserta que o resultado inclui `ptax` (cotacaoVenda com 4 casas) e `effectiveDate` (de `dataHoraCotacao`, formato ISO `yyyy-mm-dd`); o fallback de cache também os retorna (cache salvo com os novos campos).

- [ ] **Step 2:** Run: `npm test -- src/services/__tests__/fetchROE.test.ts` — Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```typescript
export type FetchROEResult = {
  roe: number
  ptax: number
  effectiveDate: string // yyyy-mm-dd retornado pelo BCB (dataHoraCotacao)
  offline: boolean
  cachedAt: string | null
  source: RoeSource
}

// em fetchROE, o $select já traz cotacaoVenda e dataHoraCotacao:
const ptax = parseFloat(parseFloat(json.value[0].cotacaoVenda).toFixed(4))
const roe = parseFloat((ptax * DEMURRAGE_ROE_MARKUP).toFixed(4))
const effectiveDate = String(json.value[0].dataHoraCotacao).slice(0, 10)
saveROECache(roe, ptax, effectiveDate) // estenda o shape do cache; leitura antiga sem os campos invalida o cache
return { roe, ptax, effectiveDate, offline: false, cachedAt: null, source: 'bcb_live' }
```

Atualize `saveROECache`/`loadCachedROE` no mesmo arquivo para carregar os novos campos; cache antigo sem eles é tratado como ausente.

- [ ] **Step 4:** Run: `npm test -- src/services/__tests__/fetchROE.test.ts` — Expected: PASS. Rode também `npm test -- src/services/demurrage` (consumidores de `FetchROEResult`).

- [ ] **Step 5:** Commit: `git commit -m "feat: fetchROE expõe PTAX e data efetiva da cotação"`

### Task 2: Migration — referência cambial persistida + RPC do Portal

**Files:**
- Create: `supabase/migrations/<próximo-número>_exchange_rate_reference.sql`
- Modify: `src/services/demurrage/demurrageKpis.ts` (persistir após fetch bem-sucedido) e o serviço de recálculo (`grep -rn "recalculate_demurrage_invoices_manual" src/services/` — o chamador grava a referência junto)
- Test: `src/services/__tests__/exchangeRateReferenceMigration.test.ts` (padrão de contrato SQL)

- [ ] **Step 1:** Migration (leia a skill `supabase-migration` antes):

```sql
-- Spec §15: referência cambial autoritativa única para header, recálculo e Portal.
-- O Portal não consulta o BCB nem deriva ROE no navegador.
CREATE TABLE IF NOT EXISTS public.exchange_rate_reference (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- singleton
  ptax NUMERIC(10,4) NOT NULL,
  roe NUMERIC(10,4) NOT NULL,
  effective_date DATE NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.exchange_rate_reference ENABLE ROW LEVEL SECURITY;
-- escrita: apenas via RPC; leitura interna: authenticated ativo (policy no padrão do repo)

CREATE OR REPLACE FUNCTION public.save_exchange_rate_reference(
  p_ptax NUMERIC, p_roe NUMERIC, p_effective_date DATE
) RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public.exchange_rate_reference (id, ptax, roe, effective_date, updated_at)
  VALUES (1, p_ptax, p_roe, p_effective_date, now())
  ON CONFLICT (id) DO UPDATE SET ptax = EXCLUDED.ptax, roe = EXCLUDED.roe,
    effective_date = EXCLUDED.effective_date, updated_at = now();
$$;
-- guard de usuário ativo no padrão das RPCs recentes; REVOKE PUBLIC/anon; GRANT authenticated

-- Leitura do Portal: só ROE e atualização — sem PTAX nem fórmula (spec §15).
CREATE OR REPLACE FUNCTION public.portal_get_current_roe()
RETURNS TABLE (roe NUMERIC, updated_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT roe, updated_at FROM public.exchange_rate_reference WHERE id = 1;
$$;
-- guard de sessão do Portal no padrão das RPCs portal_* (copie de portal_list_* na migration mais recente que as define); GRANT ao role usado pelo Portal
```

Em `fetchROE`, após sucesso `bcb_live`, chame `supabase.rpc('save_exchange_rate_reference', { p_ptax: ptax, p_roe: roe, p_effective_date: effectiveDate })` em best-effort (falha vira `reportBestEffortFailure`, não interrompe o operador).

- [ ] **Step 2:** Teste de contrato SQL: upsert singleton funciona; `portal_get_current_roe` retorna só `roe`/`updated_at`; `anon` sem EXECUTE em `save_exchange_rate_reference`; guard do Portal aplicado.
- [ ] **Step 3:** Run: `npm test -- src/services/__tests__/exchangeRateReferenceMigration.test.ts` — Expected: PASS.
- [ ] **Step 4:** Commit: `git commit -m "feat: referência cambial persistida e RPC portal_get_current_roe"`

### Task 3: Header interno — PTAX × 1,065 = ROE, sem CNY

**Files:**
- Create: `src/hooks/useRoeHeaderRate.ts`
- Modify: `src/components/layout/HeaderInfoBar.tsx` (substituir consumo de `useExchangeRates`)
- Delete: `src/hooks/useExchangeRates.ts` (e teste associado, se houver: `grep -rl useExchangeRates src/`)
- Test: `src/hooks/__tests__/useRoeHeaderRate.test.ts`

- [ ] **Step 1: Write the failing test** — mockando `fetchROE`: o hook retorna `{ ptax, roe, effectiveDate, loading, offline, refresh }`; `refresh()` reconsulta; erro sem cache expõe estado de indisponibilidade.

- [ ] **Step 2:** Run: `npm test -- src/hooks/__tests__/useRoeHeaderRate.test.ts` — Expected: FAIL.

- [ ] **Step 3: Write minimal implementation** — siga a skill `react-query-pattern`:

```typescript
// src/hooks/useRoeHeaderRate.ts
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchROE } from '../services/demurrage/demurrageKpis'

const QUERY_KEY = ['header-roe-reference']

export function useRoeHeaderRate() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchROE,
    staleTime: 60 * 60 * 1000, // staleness sinalizada, não refetch agressivo
    retry: 1,
  })
  return {
    ptax: query.data?.ptax ?? null,
    roe: query.data?.roe ?? null,
    effectiveDate: query.data?.effectiveDate ?? null,
    offline: query.data?.offline ?? false,
    loading: query.isLoading,
    unavailable: query.isError,
    refresh: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  }
}
```

No `HeaderInfoBar.tsx`: remova todo consumo de CNY; renderize no padrão visual do Demurrage Manager:
`PTAX Venda R$ {ptax} → PTAX × 1,065 = ROE R$ {roe} ({effectiveDate em dd/mm/aaaa})` com botão de atualização (`refresh`), estados de loading/indisponível/staleness (`offline` mostra "cotação em cache de {cachedAt}"), **sem input manual**, e oculto no mobile (classe `hidden md:flex`, padrão responsivo do arquivo). A entrada manual de PTAX permanece exclusivamente em `/demurrage`.

- [ ] **Step 4:** Run: `npm test -- src/hooks/__tests__/useRoeHeaderRate.test.ts && npm run lint` — Expected: PASS; `grep -rn "CNY\|header_ptax_display" src/` retorna vazio.

- [ ] **Step 5:** Commit: `git commit -m "feat!: header cambial usa fetchROE compartilhado; remove CNY e contrato paralelo"`

### Task 4: Portal — ROE vigente na aba Demurrage

**Files:**
- Modify: `src/pages/PortalBilling.tsx` (aba `demurrage`, acima da listagem), `src/services/portalBilling.ts` (novo fetch), `src/hooks/usePortalBilling.ts` (novo hook de query)
- Test: teste existente de `PortalBilling`/`usePortalBilling` (localize com `grep -rl usePortalBilling src/ --include=*.test.*`)

- [ ] **Step 1: Write the failing test** — hook `usePortalCurrentRoe` chama `supabase.rpc('portal_get_current_roe')`; componente renderiza `ROE vigente: R$ 5,4288 · atualizado em 16/07/2026` quando a query resolve; nada é renderizado quando indisponível (sem erro visível ao cliente).
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3:** Implemente service + hook (cache key nova em `src/services/queryKeys.ts`, família portal) + render condicional à aba `demurrage`. Formatação BRL com 4 casas (`toLocaleString('pt-BR', { minimumFractionDigits: 4 })`). Sem PTAX, sem fórmula, sem botão de atualização (spec §15). O detalhe da invoice permanece intocado (já mostra o ROE aplicado/congelado).
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat: Portal exibe ROE vigente na aba Demurrage"`

### Task 5: Remoção integral do Backfill do Portal

**Files:**
- Delete: `src/pages/AdminPortalBackfill.tsx` (+ teste, se houver)
- Modify: `src/App.tsx` (linha 36 `lazyPage` e linha 134 `Route /admin/portal-backfill`), `src/components/layout/AppLayout.tsx` (item de menu — localize com `grep -n "portal-backfill" src/components/layout/AppLayout.tsx`), `src/services/portalProvisioning.ts` (remover `runPreflight` linha 106, `runBackfill` linha 112 e tipos exclusivos)
- Create: `supabase/migrations/<próximo-número>_drop_portal_backfill_rpcs.sql`
- Test: `src/services/__tests__/dropPortalBackfillMigration.test.ts`

- [ ] **Step 1:** Migration:

```sql
-- Spec §14: backfill inicial concluído. RPCs removidas; migrations históricas
-- e o reparo interno vigente (self-heal, migration 198) permanecem.
DROP FUNCTION IF EXISTS public.portal_provisioning_preflight(); -- confirme a assinatura na migration que a criou
DROP FUNCTION IF EXISTS public.portal_provisioning_backfill(uuid); -- idem (grep -rn "portal_provisioning_backfill" supabase/migrations/)
```

- [ ] **Step 2:** Delete página, rota, lazy import, item de menu, funções e tipos. `grep -rn "portal-backfill\|runPreflight\|runBackfill\|portal_provisioning_preflight\|portal_provisioning_backfill" src/` deve retornar vazio. **Não toque** no self-heal da migration 198.
- [ ] **Step 3:** Teste de contrato: functions ausentes do catálogo.
- [ ] **Step 4:** Run: `npm run lint && npm test && npm run build` — Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat!: remove backfill do Portal — menu, rota, página, serviços e RPCs (spec §14)"`

### Task 6: Tela Containers — renomear datas e remover Importar IMO/OOG

**Files:**
- Modify: `src/pages/Containers.tsx` (remover imports das linhas 26–29, estado `parsedFlags` linha 61, handlers 151/172, botão `Importar IMO/OOG` linha 250 e o modal associado; renomear botão/título do modal de datas para `Importar Datas de Descarga e Devolução`)
- Modify: `src/components/shared/ContainerDatesImportModal.tsx` (título; validação: descarga obrigatória, devolução opcional e ≥ descarga — confira se a validação atual já trata devolução como opcional; ajuste se obrigatória)
- Delete: `src/services/containerFlagsImport.ts` + testes exclusivos (`grep -rl containerFlagsImport src/`)
- Test: testes existentes de `containerDatesImport` e da página

- [ ] **Step 1: Write the failing test** — em `src/services/__tests__/containerDatesImport.test.ts` (existente): linha sem devolução é válida; devolução anterior à descarga é rejeitada; linha sem descarga é rejeitada.
- [ ] **Step 2:** Run — Expected: FAIL se a validação atual divergir; se já passar, siga (o contrato fica registrado).
- [ ] **Step 3:** Aplique renomeações e remoções. A resolução de divergências do Baplie (fonte física única de IMO/OOG) permanece intocada em `src/services/baplieReconciliation.ts`.
- [ ] **Step 4:** Run: `npm run lint && npm test && npm run build` — Expected: PASS; `grep -rn "containerFlagsImport\|Importar IMO/OOG" src/` vazio.
- [ ] **Step 5:** Commit: `git commit -m "feat!: remove Importar IMO/OOG; renomeia importação de datas (spec §11)"`

### Task 7: Aba Importação da Viagem — ordem, nomes e CE Mercante com escopo

**Files:**
- Modify: `src/components/shared/VoyageImportActions.tsx` — labels (linha 25–31): remover `cntr` (se WS1 ainda não removeu), `vaziosImp: 'Vazios IMP'`, `vehicles: 'Veículos'`; ordem de render: Baplie EDI, B/L, CE Mercante, Manifesto BB, Veículos, Vazios IMP; adicionar entrada CE Mercante que abre `CeMercanteImportModal` com `voyageId` travado
- Modify: `src/components/shared/CeMercanteImportModal.tsx` — prop opcional `lockedVoyageId?: number`; no preview, linhas cujo B/L pertence a outra viagem viram erro bloqueante (excluídas de `preview.rows`, listadas em `rowErrors` com mensagem `B/L {bl} pertence a outra viagem`)
- Modify: `src/services/ceMercanteImport.ts` — helper `partitionRowsByVoyage(rows, voyageId)` que consulta os B/Ls e separa válidos/bloqueados
- Test: `src/services/__tests__/ceMercanteImport.test.ts` (existente — adicionar casos) e teste do modal

- [ ] **Step 1: Write the failing test** — `partitionRowsByVoyage`: linha de B/L da viagem passa; de outra viagem vai para bloqueados com a mensagem; B/L inexistente segue o comportamento atual de erro.
- [ ] **Step 2:** Run: `npm test -- src/services/__tests__/ceMercanteImport.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implemente helper + modal + reorganização. Planilhas-modelo: CE Mercante já tem (`/templates/ce-mercante-modelo.xlsx|csv` — linhas 180–190 do modal); adicione equivalentes para Manifesto BB e Veículos em `public/templates/` (gere a partir dos headers aceitos pelos parsers `breakbulkManifestParser.ts` e `vehicleImport.ts`) com os mesmos links de download nos respectivos modais.
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat: aba Importação reordenada; CE Mercante travado na viagem com modelo (spec §9)"`

### Task 8: Confirmação universal de exclusões persistidas

**Files:**
- Audit + Modify: todos os pontos de exclusão persistida sem confirmação
- Test: testes de comportamento dos componentes ajustados

- [ ] **Step 1:** Inventário: `grep -rn "\.delete()\|delete_\|runDelete\|handleDelete\|excluir\|Excluir" src/pages src/components --include=*.tsx -l` e, para cada resultado, verifique se a ação usa `useConfirm` (`src/components/ui/ConfirmDialogProvider`). Liste os que deletam registro persistido sem diálogo.
- [ ] **Step 2:** Para cada caso sem confirmação: envolva com `useConfirm`, identificando o objeto e consequências conhecidas, ação nominal `Excluir` (spec §7). NÃO adicione confirmação a: remover linha não salva, limpar filtros, desfazer seleção, cancelar edição.
- [ ] **Step 3:** Atualize/adicione um teste por componente alterado (padrão dos `*.behavior.test.tsx`).
- [ ] **Step 4:** Run: `npm test` — Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat: confirmação explícita em toda exclusão de registro persistido (spec §7)"`

### Task 9: Documentação e verificação final

**Files:**
- Modify: `docs/modules/demurrage.md` (divergência do câmbio de display vira comportamento vigente), `docs/modules/operacao-suporte.md` (parágrafo do CNY), `docs/modules/portal-cliente.md` (backfill removido), `docs/modules/manifesto-edi.md` (§/containers), `docs/ARCHITECTURE.md` (rota `/admin/portal-backfill` sai da tabela), `docs/RASTREABILIDADE.md` (linhas de backfill, containers IMO/OOG, header), `CONTEXT.md` (nota de CNY no termo ROE)

- [ ] **Step 1:** Atualize todos os documentos vivos; remova as marcações de rota/fluxo condenado que este WS eliminou.
- [ ] **Step 2:** Run: `npm run docs:check && npm run lint && npm test && npm run build` — Expected: PASS.
- [ ] **Step 3:** Verifique spec §7, §9, §11, §14, §15 critério a critério; validação visual (skill `run`): header desktop/mobile, aba Demurrage do Portal, modais de importação.
- [ ] **Step 4:** Commit: `git commit -m "docs: câmbio unificado e legados removidos (spec §7, §9, §11, §14, §15)"`
