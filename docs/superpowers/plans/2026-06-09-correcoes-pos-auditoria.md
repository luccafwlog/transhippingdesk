# Correcoes Pos-Auditoria Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** corrigir os achados da auditoria priorizando riscos de producao em dinheiro, seguranca, PIX, demurrage e faturamento.

**Architecture:** executar em ondas pequenas e verificaveis. Primeiro corrigir bugs financeiros e PIX, depois hardening Supabase/RLS, depois performance, validacao, UX e documentacao. Cada tarefa deve comecar por teste/verificacao que prove o problema, aplicar a menor mudanca suficiente e rodar validacoes antes de marcar como concluida.

**Tech Stack:** React 19, TypeScript, Vite, Supabase/Postgres/RLS, TanStack Query v5, Zod v4, Vitest, npm audit.

---

## Diretriz obrigatoria de acompanhamento

- [ ] Manter este arquivo atualizado durante a execucao.
- [ ] Cada etapa concluida deve ser marcada imediatamente trocando `- [ ]` por `- [x]`.
- [ ] Nao marcar uma etapa como feita sem ter executado a verificacao indicada na propria etapa.
- [ ] Se uma etapa for substituida por outra solucao, registrar uma nota curta abaixo da etapa explicando a decisao.
- [ ] Nao editar `src/types/database.ts`; ele e gerado.
- [ ] Evitar refactors adjacentes. Cada mudanca deve rastrear diretamente para um achado da auditoria.
- [ ] Preferir commits pequenos por tarefa concluida.

## Baseline conhecido

- Plano revalidado contra `origin/main` em 2026-06-09, commit `10fb69b` (`Atualizar plano de correções pós-auditoria contra a main atual (#181)`).
- `npm run lint`: passou em 2026-06-09 durante a auditoria inicial.
- `npm test`: passou em 2026-06-09 durante a auditoria inicial com 48 arquivos passados, 1 skipped, 225 testes passados, 9 skipped.
- `npm test`: passou em 2026-06-09 antes da execucao da Task 1 com 49 arquivos passados, 1 skipped, 233 testes passados, 9 skipped.
- `npm audit --omit=dev`: reexecutado em 2026-06-09 contra `origin/main` atual; ainda encontra vulnerabilidades altas em `react-router`/`react-router-dom` e `xlsx`.
- Esta branch limpa contem apenas este plano novo sobre `origin/main`. O arquivo antigo `docs/superpowers/plans/2026-06-01-ajustes-operacionais-financeiros.md` existe na `main` atual e nao deve ser removido por este plano.

## Checagem de defasagem contra a main atual

- [x] Antes de executar qualquer task, rodar `git fetch origin --prune` e confirmar que a branch de trabalho esta baseada na `origin/main` mais recente.
- [x] Se `origin/main` tiver avancado, revalidar as localizacoes citadas nas tasks antes de editar codigo.
- [ ] Se um achado ja tiver sido corrigido na `main`, marcar a task como substituida e registrar a evidencia abaixo da propria task.
- [ ] Se um arquivo citado tiver sido renomeado, atualizar este plano antes de implementar.
- [x] Nao reaproveitar a branch antiga `codex/code-quality-cleanup` para executar este plano; ela nasceu de uma base antiga e carregava mudancas que conflitam com a `main` atual.

---

## Task 1: Corrigir conciliacao PIX de demurrage

**Achados cobertos:** #1, #7 parcialmente, #12 parcialmente.

**Files:**
- Modify: `src/services/reconciliacao.ts`
- Modify: `src/services/__tests__/reconciliacao.test.ts`

- [x] **Step 1: Escrever teste para valor divergente em demurrage**

Adicionar em `src/services/__tests__/reconciliacao.test.ts` um caso que chama `confirmUnifiedPixReconciliation` com `source: 'demurrage'`, `amount: 100`, `transaction.amount: 90`, e espera rejeicao sem update bem-sucedido.

Expected assertion shape:

```ts
await expect(confirmUnifiedPixReconciliation(matches)).rejects.toThrow(/valor|diverg/i)
```

- [x] **Step 2: Escrever teste para erro do update Supabase**

Adicionar mock para `demurrage_invoices.update(...).eq(...)` retornar `{ error: new Error('db down') }` e esperar rejeicao.

Expected assertion shape:

```ts
await expect(confirmUnifiedPixReconciliation(matches)).rejects.toThrow('db down')
```

- [x] **Step 3: Rodar teste e confirmar falha atual**

Run:

```bash
npm test -- src/services/__tests__/reconciliacao.test.ts
```

Expected: os novos testes falham antes da implementacao.

- [x] **Step 4: Implementar validacao minima**

Em `src/services/reconciliacao.ts`, antes do update de demurrage:
- calcular diferenca absoluta entre `m.transaction.amount` e `m.amount`;
- rejeitar se diferenca for maior que `0.01`;
- capturar `{ error }` do update;
- lancar erro se `error` existir.

- [x] **Step 5: Rodar teste focado**

Run:

```bash
npm test -- src/services/__tests__/reconciliacao.test.ts
```

Expected: todos os testes desse arquivo passam.

- [x] **Step 6: Rodar suite completa**

Run:

```bash
npm test
```

Expected: suite passa.

- [x] **Step 7: Commit**

Suggested commit:

```bash
git add src/services/reconciliacao.ts src/services/__tests__/reconciliacao.test.ts
git commit -m "fix: validate demurrage pix reconciliation"
```

**Acceptance:** demurrage so e marcada como paga quando TXID e valor conferem; falha de banco interrompe o fluxo.

---

## Task 2: Rejeitar devolucao anterior a descarga em demurrage

**Achados cobertos:** #3, #12 parcialmente.

**Files:**
- Modify: `src/services/demurrage/demurrageRates.ts`
- Modify: `src/services/demurrage/demurrageContainers.ts`
- Modify: `src/services/containerDatesImport.ts`
- Modify: `src/pages/Demurrage.tsx`
- Modify: `src/services/demurrage/__tests__/calculateDemurrage.test.ts`
- Create: `supabase/migrations/<timestamp>_demurrage_date_order_constraints.sql`

- [x] **Step 1: Escrever teste de calculo com datas invertidas**

Em `src/services/demurrage/__tests__/calculateDemurrage.test.ts`, adicionar:

```ts
expect(() => calculateDemurrage('20GP', '2026-01-10', '2026-01-09')).toThrow(/devolucao|descarga|return|discharge/i)
```

- [x] **Step 2: Rodar teste e confirmar falha atual**

Run:

```bash
npm test -- src/services/demurrage/__tests__/calculateDemurrage.test.ts
```

Expected: novo teste falha porque hoje retorna dias negativos/within_free_time.

- [x] **Step 3: Validar no calculo**

Em `calculateDemurrage`, apos calcular `noonMs(dischargeDate)` e `noonMs(returnDate)`, lancar erro se retorno for anterior a descarga.

- [x] **Step 4: Validar nos services de update**

Em `updateContainerDates` e `updateContainerReturnDate`, bloquear `returnDate < dischargeDate` antes de persistir.

- [x] **Step 5: Validar importacao de datas**

Em `parseRows` de `src/services/containerDatesImport.ts`, quando houver `returnDate`, rejeitar linha com devolucao anterior a descarga e incluir `rowErrors`.

- [x] **Step 6: Validar UI manual**

Em `src/pages/Demurrage.tsx`, antes de `containerDatesMutation.mutate`, exibir toast de erro quando `editReturn` existir e for anterior a `editDischarge`.

- [x] **Step 7: Criar constraint no banco**

Criar migration com checks para impedir persistencia inconsistente, por exemplo:

```sql
ALTER TABLE public.bl_containers
  ADD CONSTRAINT bl_containers_return_after_discharge_chk
  CHECK (
    return_date IS NULL
    OR discharge_date IS NULL
    OR return_date >= discharge_date
  );
```

Verificar se `demurrage_invoice_items.total_days` tambem deve receber `CHECK (total_days >= 0)` apos confirmar dados existentes.

- [x] **Step 8: Rodar testes**

Run:

```bash
npm test -- src/services/demurrage/__tests__/calculateDemurrage.test.ts
npm test
```

Expected: testes passam.

- [x] **Step 9: Commit**

Suggested commit:

```bash
git add src/services/demurrage/demurrageRates.ts src/services/demurrage/demurrageContainers.ts src/services/containerDatesImport.ts src/pages/Demurrage.tsx src/services/demurrage/__tests__/calculateDemurrage.test.ts supabase/migrations
git commit -m "fix: reject demurrage return before discharge"
```

**Acceptance:** entrada manual, importacao e banco rejeitam devolucao anterior a descarga.

---

## Task 3: Propagar falhas de ledger e persistencia PIX

**Achados cobertos:** #4, #8 parcialmente.

**Files:**
- Modify: `src/services/billing.ts`
- Modify: `src/services/billingLedger.ts`
- Modify or create: `src/services/__tests__/billingHelpers.test.ts` or `src/services/__tests__/billingLedger.test.ts`

- [ ] **Step 1: Testar falha em `link_invoice_to_ledger`**

Criar teste que mocka `supabase.rpc('link_invoice_to_ledger')` retornando `{ error: new Error('ledger failed') }` apos criacao de invoice, e espera rejeicao.

- [ ] **Step 2: Testar falha ao persistir PIX consolidado**

Criar teste para `createConsolidatedInvoice` em que o update em `invoices` retorna erro e o service rejeita.

- [ ] **Step 3: Confirmar falha atual**

Run:

```bash
npm test -- src/services/__tests__/billingHelpers.test.ts
```

Expected: testes novos falham antes da correcao.

- [ ] **Step 4: Implementar checagem de erro**

Em `src/services/billing.ts`, capturar retorno de `supabase.rpc('link_invoice_to_ledger', ...)` e lancar erro quando existir `error`.

Em `src/services/billingLedger.ts`, capturar retorno do update `pix_payload` e lancar erro quando existir `error`.

- [ ] **Step 5: Rodar testes focados e suite**

Run:

```bash
npm test -- src/services/__tests__/billingHelpers.test.ts
npm test
```

Expected: testes passam.

- [ ] **Step 6: Commit**

Suggested commit:

```bash
git add src/services/billing.ts src/services/billingLedger.ts src/services/__tests__
git commit -m "fix: surface ledger and pix persistence failures"
```

**Acceptance:** fluxo nao reporta sucesso quando ledger ou payload PIX falham.

---

## Task 4: Endurecer RPC financeiro `get_consolidated_invoice_item_breakdown`

**Achados cobertos:** #2.

**Files:**
- Current main reference: `supabase/migrations/20260608174131_consolidated_invoice_item_breakdown.sql`
- Create: `supabase/migrations/<timestamp>_restrict_consolidated_invoice_breakdown.sql`
- Create or modify: `src/services/__tests__/consolidatedInvoiceBreakdownMigration.test.ts`

- [ ] **Step 1: Escrever teste de migration**

Criar teste que le a nova migration e verifica:
- funcao `public.get_consolidated_invoice_item_breakdown`;
- `SECURITY DEFINER`;
- `SET search_path = public, pg_temp`;
- presenca de `public.is_admin()`;
- `GRANT EXECUTE ... TO authenticated`.

- [ ] **Step 2: Criar migration**

Criar uma nova migration que substitui a funcao atualmente definida em `supabase/migrations/20260608174131_consolidated_invoice_item_breakdown.sql` para exigir:

```sql
WHERE public.is_active_user()
  AND public.is_admin()
  AND irl.invoice_id = p_invoice_id
```

Tambem ajustar `SET search_path = public, pg_temp`.

- [ ] **Step 3: Rodar teste de migration**

Run:

```bash
npm test -- src/services/__tests__/consolidatedInvoiceBreakdownMigration.test.ts
```

Expected: passa.

- [ ] **Step 4: Rodar suite**

Run:

```bash
npm test
```

Expected: suite passa.

- [ ] **Step 5: Commit**

Suggested commit:

```bash
git add supabase/migrations src/services/__tests__/consolidatedInvoiceBreakdownMigration.test.ts
git commit -m "fix: restrict consolidated invoice breakdown rpc"
```

**Acceptance:** usuario interno ativo sem perfil admin nao consegue obter breakdown financeiro por esse RPC.

---

## Task 5: Endurecer RLS permissiva remanescente

**Achados cobertos:** #6.

**Files:**
- Create: `supabase/migrations/<timestamp>_harden_remaining_permissive_rls.sql`
- Create or modify: `src/services/__tests__/rlsHardeningMigration.test.ts`

- [ ] **Step 1: Escrever teste de migration**

Teste deve verificar que a nova migration referencia:
- `baplie_reconciliation_resolutions`;
- `baplie_containers`;
- `voyage_export_schedules`;
- `DROP POLICY IF EXISTS`;
- `public.is_active_user()`;
- `public.is_admin()`.

- [ ] **Step 2: Criar migration de hardening**

Aplicar politica:
- SELECT operacional: `public.is_active_user()`;
- INSERT/UPDATE: `public.is_active_user()` quando dado operacional for editavel por equipe ativa; usar `public.is_admin()` se for dado sensivel;
- DELETE: `public.is_admin()`.

Escopo revalidado na `main` atual:
- `supabase/migrations/055_baplie_reconciliation_resolutions.sql` ainda define policies sempre verdadeiras.
- `supabase/migrations/20260520132021_create_baplie_containers_staging.sql` e `supabase/migrations/20260521000000_voyage_export_schedules.sql` ainda tem policies historicas sempre verdadeiras; `20260530102909_tighten_permissive_rls_policies.sql` endurece parte da escrita, mas mantem leitura ampla e DELETE por usuario ativo.
- Ocorrencias em `028_demurrage_module.sql` sao historicas e foram cobertas por `042_rls_module_hardening.sql`; nao gastar esforco nelas sem confirmar policy efetiva no banco.

- [ ] **Step 3: Rodar teste de migration**

Run:

```bash
npm test -- src/services/__tests__/rlsHardeningMigration.test.ts
```

Expected: passa.

- [ ] **Step 4: Rodar busca anti-regressao**

Run:

```bash
rg -n "USING \\(true\\)|WITH CHECK \\(true\\)|using \\(true\\)|with check \\(true\\)" supabase/migrations
```

Expected: ocorrencias antigas podem continuar no historico, mas a nova migration deve neutralizar as policies alvo. Registrar no PR quais ocorrencias sao historicas.

- [ ] **Step 5: Commit**

Suggested commit:

```bash
git add supabase/migrations src/services/__tests__/rlsHardeningMigration.test.ts
git commit -m "fix: harden remaining permissive rls policies"
```

**Acceptance:** tabelas alvo nao mantem escrita/delete irrestritos para usuario autenticado.

---

## Task 6: Mitigar dependencias vulneraveis

**Achados cobertos:** #5, #11 parcialmente.

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Possibly modify parser files that use `xlsx`
- Possibly update docs in Task 11

- [ ] **Step 1: Atualizar React Router**

Run:

```bash
npm install react-router-dom@latest
npm audit --omit=dev
```

Expected: alertas de `react-router`/`react-router-dom` desaparecem ou reduzem para risco aceitavel.

- [ ] **Step 2: Decidir mitigacao para `xlsx`**

Escolher uma destas opcoes e registrar no PR:
- substituir por biblioteca mantida;
- manter temporariamente com limites de upload/linhas e aceite formal;
- isolar parsing fora da thread principal.

- [ ] **Step 3: Rodar validacoes**

Run:

```bash
npm run lint
npm test
npm run build
npm audit --omit=dev
```

Expected: lint, testes e build passam; audit nao tem vulnerabilidade corrigivel ignorada.

- [ ] **Step 4: Commit**

Suggested commit:

```bash
git add package.json package-lock.json
git commit -m "chore: address dependency audit findings"
```

**Acceptance:** React Router esta fora do range vulneravel; risco `xlsx` tem mitigacao clara.

---

## Task 7: Aplicar limite de upload nos parsers faltantes

**Achados cobertos:** #11.

**Files:**
- Modify: `src/services/customerBase.ts`
- Modify: `src/pages/Reconciliacao.tsx` or `src/services/demurrage/demurrageKpis.ts`
- Modify or create tests for customer base and PIX extract parsing

Escopo revalidado na `main` atual:
- `src/services/customerBase.ts` ainda chama `file.arrayBuffer()` sem `assertUploadSize`.
- `src/pages/Reconciliacao.tsx` ainda chama `file.arrayBuffer()` antes de `parsePixExtract`.
- O novo parser `src/services/ceMercanteEdiParser.ts` ja usa `assertUploadSize(file)` e nao precisa entrar nesta task.

- [ ] **Step 1: Testar base de clientes acima do limite**

Criar teste com `File` mockado contendo `size > 10 * 1024 * 1024` e esperar erro de `assertUploadSize`.

- [ ] **Step 2: Testar extrato PIX acima do limite**

Se a validacao ficar em `Reconciliacao.tsx`, testar o fluxo de pagina. Se ficar em service, ajustar `parsePixExtract` para receber tambem `File` ou criar wrapper testavel.

- [ ] **Step 3: Aplicar `assertUploadSize`**

Adicionar `assertUploadSize(file)` antes de `file.arrayBuffer()` em `parseCustomerBaseFile`.

Para extrato PIX, validar tamanho antes de `file.arrayBuffer()` no fluxo de upload.

- [ ] **Step 4: Rodar testes**

Run:

```bash
npm test
```

Expected: suite passa.

- [ ] **Step 5: Commit**

Suggested commit:

```bash
git add src/services/customerBase.ts src/pages/Reconciliacao.tsx src/services/__tests__ src/pages/__tests__
git commit -m "fix: enforce upload limits for remaining xlsx parsers"
```

**Acceptance:** nenhum importador XLSX de entrada externa chama `XLSX.read` antes de validar tamanho.

---

## Task 8: Melhorar performance de faturamento e listagens grandes

**Achados cobertos:** #9, #10.

**Files:**
- Modify: `src/services/billing.ts`
- Modify: `src/hooks/useBls.ts`
- Possibly create Supabase migrations/RPCs for summaries/export

- [ ] **Step 1: Criar teste para exportacao paginada**

Adicionar teste que simula `listInvoicesForExport` retornando mais de um lote e verifica que nenhum lote e truncado por `pageSize: 100000`.

- [ ] **Step 2: Substituir exportacao gigante por loop paginado**

Implementar busca em lotes menores, por exemplo 1000, ate lote menor que tamanho da pagina.

- [ ] **Step 3: Reduzir `select *` em faturamento**

Trocar `INVOICE_LIST_SELECT` para colunas realmente usadas pela UI/listagem/exportacao.

- [ ] **Step 4: Avaliar `useBls` e `useContainers`**

Mover filtros que exigem `fetchAllBls` para RPC/consulta SQL quando possivel. Se nao for possivel nesta tarefa, documentar no PR o motivo e abrir follow-up.

- [ ] **Step 5: Rodar testes e smoke manual**

Run:

```bash
npm test
npm run build
```

Smoke manual:
- abrir `/faturamento`;
- exportar faturas;
- abrir `/manifestos`;
- abrir `/containers`.

- [ ] **Step 6: Commit**

Suggested commit:

```bash
git add src/services/billing.ts src/hooks/useBls.ts src/services/__tests__
git commit -m "perf: page billing exports and heavy bl queries"
```

**Acceptance:** exportacoes nao dependem de `pageSize: 100000`; queries principais selecionam menos dados.

---

## Task 9: Centralizar validacao financeira com Zod

**Achados cobertos:** #12.

**Files:**
- Create: `src/services/financialValidation.ts`
- Create: `src/services/__tests__/financialValidation.test.ts`
- Modify: `src/pages/Faturamento.tsx`
- Modify: `src/pages/Demurrage.tsx`

- [ ] **Step 1: Criar schemas**

Criar schemas para:
- pagamento: valor positivo, metodo permitido, data opcional valida;
- item manual: descricao obrigatoria, quantidade positiva, valor unitario positivo;
- desconto demurrage: tipo permitido, valor nao negativo, percentual entre 0 e 100 quando aplicavel;
- datas demurrage: descarga obrigatoria, devolucao opcional e nao anterior a descarga.

- [ ] **Step 2: Testar entradas comuns**

Casos minimos:
- `"10,50"` vira `10.5`;
- `""` rejeita onde obrigatorio;
- `"-1"` rejeita;
- `"abc"` rejeita;
- percentual `101` rejeita;
- devolucao anterior a descarga rejeita.

- [ ] **Step 3: Substituir parsing manual**

Trocar `Number(...)`/`parseFloat(...)` dispersos em fluxos financeiros pelos schemas.

- [ ] **Step 4: Rodar testes**

Run:

```bash
npm test -- src/services/__tests__/financialValidation.test.ts
npm test
```

Expected: testes passam.

- [ ] **Step 5: Commit**

Suggested commit:

```bash
git add src/services/financialValidation.ts src/services/__tests__/financialValidation.test.ts src/pages/Faturamento.tsx src/pages/Demurrage.tsx
git commit -m "refactor: validate financial forms with zod"
```

**Acceptance:** regras monetarias criticas estao testadas e reutilizaveis.

---

## Task 10: Confirmacoes e acessibilidade em acoes destrutivas

**Achados cobertos:** #14.

**Files:**
- Modify: `src/pages/ClienteFicha.tsx`
- Modify: `src/pages/Demurrage.tsx`
- Possibly modify tests under `src/pages/__tests__`

- [ ] **Step 1: Adicionar confirmacao para remover contato**

Usar `useConfirm` antes de `deleteCustomerContact`.

- [ ] **Step 2: Adicionar `aria-label` em botao icon-only**

No botao com `Trash2`, adicionar label como `aria-label="Remover contato"`.

- [ ] **Step 3: Adicionar confirmacoes em demurrage**

Confirmar antes de:
- cancelar invoice;
- desemitir invoice;
- desmarcar pagamento.

- [ ] **Step 4: Rodar lint e testes**

Run:

```bash
npm run lint
npm test
```

Expected: passa.

- [ ] **Step 5: Commit**

Suggested commit:

```bash
git add src/pages/ClienteFicha.tsx src/pages/Demurrage.tsx src/pages/__tests__
git commit -m "fix: confirm destructive actions and label icon buttons"
```

**Acceptance:** acoes destrutivas pedem confirmacao e controles icon-only tem nome acessivel.

---

## Task 11: Corrigir documentacao e registrar decisoes

**Achados cobertos:** #15 e divergencia README/ADR.

**Files:**
- Modify: `README.md`
- Modify: `docs/ROADMAP.md` if project owner wants roadmap updated
- Possibly create ADR if `xlsx` mitigation is accepted instead of fixed

- [ ] **Step 1: Atualizar README do portal**

Trocar descricao de `/portal/login` de CNPJ/CPF + senha para email + senha via Supabase Auth.

- [ ] **Step 2: Registrar status de `xlsx`**

Se `xlsx` continuar no projeto, registrar:
- motivo temporario;
- mitigacoes aplicadas;
- gatilho para substituicao.

- [ ] **Step 3: Rodar checagem simples**

Run:

```bash
rg -n "CNPJ/CPF \\+ senha|CNPJ \\+ senha|password_hash|xlsx" README.md docs
```

Expected: referencias legadas sao intencionais ou atualizadas.

- [ ] **Step 4: Commit**

Suggested commit:

```bash
git add README.md docs
git commit -m "docs: align portal auth and audit followups"
```

**Acceptance:** documentacao nao contradiz o fluxo atual de portal e registra decisoes de risco.

---

## Validacao final da branch

- [ ] Rodar lint.

```bash
npm run lint
```

- [ ] Rodar testes unitarios.

```bash
npm test
```

- [ ] Rodar build.

```bash
npm run build
```

- [ ] Rodar audit de dependencias de producao.

```bash
npm audit --omit=dev
```

- [ ] Fazer smoke test manual de rotas criticas:
  - `/login`
  - `/portal/login`
  - `/portal/billing`
  - `/faturamento`
  - `/reconciliacao`
  - `/demurrage`
  - `/baplie`
  - `/viagens`

- [ ] Conferir `git status --short` e garantir que apenas arquivos relacionados ao plano foram alterados.

- [ ] Marcar esta secao como concluida somente depois que todas as validacoes acima passarem ou tiverem justificativa registrada.

