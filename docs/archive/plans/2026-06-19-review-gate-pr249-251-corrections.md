# Review Gate PRs 249–251 Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir as regressões dos PRs 249–251 e tornar o gate de revisão uma fronteira segura para B/Ls novos ou ainda não faturados, sem alterar os 104 históricos de teste já faturados.

**Architecture:** Uma migration posterior redefine as funções finais do gate, restaura o contrato de reconciliação, reforça importação e faturamento e não executa backfill. O frontend passa a consumir os motivos canônicos já persistidos, sem consultar diretamente a tabela admin-only de contas do portal. O provisionamento fica inativo até a Edge Function confirmar um `auth_user_id`.

**Tech Stack:** PostgreSQL/Supabase migrations e RLS, React 19, TypeScript, TanStack Query, Vitest e Testing Library.

**Execução:** concluída em 2026-06-19 nos commits `92f7faf`, `effb648` e
`d408448`; a documentação viva foi atualizada no commit subsequente. Os
checkboxes abaixo permanecem como roteiro histórico de TDD, não como status
operacional.

---

### Task 1: Especificar o contrato SQL corrigido

**Files:**
- Create: `src/services/__tests__/reviewGateHardeningMigration.test.ts`
- Create: `supabase/migrations/20260619130000_review_gate_hardening.sql`

- [ ] **Step 1: Escrever testes falhos para o contrato final**

Criar um teste que leia a nova migration e exija:

```ts
expect(sql).toContain('a.auth_user_id IS NOT NULL')
expect(sql).toContain('SECURITY DEFINER')
expect(sql).toContain(
  'REVOKE ALL ON FUNCTION public.compute_bl_review_pendencies(TEXT) FROM PUBLIC, anon, authenticated',
)
expect(sql).toContain('customer_reconciliation_status = CASE')
expect(sql).toContain('customer_reconciliation_notes = CASE')
expect(sql).toContain('billing_hold_reason = CASE')
expect(sql).toContain('PERFORM public.sync_customer_reconciliation_queue_for_bl(p_bl_id)')
expect(sql).toContain("a->>'field_name' IS DISTINCT FROM 'review_status'")
expect(sql).toContain("'review_status', v_status")
expect(sql).toContain('public.apply_bl_review_gate_after_import(v_bl_ids, p_uploaded_by)')
expect(sql).toContain('public.compute_bl_review_pendencies(p_bl_id)')
expect(sql).toContain('public.compute_bl_review_pendencies(NEW.customer_id, NEW.cargo_mode, NEW.bb_weight_ton)')
expect(sql).not.toMatch(/UPDATE\s+public\.bls[\s\S]+WHERE[\s\S]+review_status\s*<>/i)
```

- [ ] **Step 2: Confirmar RED**

Run:

```bash
npx vitest run src/services/__tests__/reviewGateHardeningMigration.test.ts
```

Expected: FAIL porque `20260619130000_review_gate_hardening.sql` ainda não existe.

- [ ] **Step 3: Criar a migration sem backfill**

A migration deve:

1. criar a sobrecarga interna:

```sql
CREATE OR REPLACE FUNCTION public.compute_bl_review_pendencies(
  p_customer_id BIGINT,
  p_cargo_mode TEXT,
  p_bb_weight_ton NUMERIC
)
RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp;
```

Ela retorna as quatro travas e considera portal pronto somente com:

```sql
a.active = true
AND a.auth_user_id IS NOT NULL
```

Revogar `PUBLIC`, `anon` e `authenticated` dessa sobrecarga e da versão por
`p_bl_id`; elas são helpers internos.

2. recriar `save_bl_review` como `SECURITY DEFINER`, validando:

```sql
IF auth.uid() IS NULL
   OR NOT public.is_active_user()
   OR p_changed_by IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'Usuario sem permissao ativa para revisar B/L.'
    USING ERRCODE = '42501';
END IF;
```

Restaurar os campos de reconciliação da migration
`025_billing_orchestration_portal.sql`, recomputar o gate, manter a linha de
pendências separada das notas humanas, ignorar qualquer audit row de
`review_status`, inserir a transição real de status e chamar
`sync_customer_reconciliation_queue_for_bl`.

3. criar `apply_bl_review_gate_after_import(TEXT[], UUID)`, que:

- valida usuário ativo e ator;
- pula B/L com `financial_status = 'invoiced'` ou invoice ativa;
- apenas adiciona pendências canônicas e marca `pending_review`;
- preserva motivos de parser existentes;
- sincroniza a fila;
- não limpa B/Ls sem pendências e não faz `UPDATE` global.

4. redefinir `import_manifest_with_postprocess_transactional` para:

```sql
-- criar contatos antes do gate
INSERT INTO public.customer_contacts (...);

PERFORM public.apply_bl_review_gate_after_import(v_bl_ids, p_uploaded_by);
PERFORM public.run_billing_for_import_batch(v_batch_id, p_uploaded_by, true);
```

5. redefinir `mark_bl_ready_for_billing`, o trigger
`promote_calculated_bl_ready_for_billing` e
`prevent_pending_review_invoice` para consultarem o gate canônico.

6. aplicar default-deny:

```sql
REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ... TO authenticated;
```

Funções exclusivas de trigger também revogam `authenticated`.

7. terminar com rollback documental que restaura as definições anteriores por
reaplicação das migrations 249/guard, sem executar rollback automático.

- [ ] **Step 4: Confirmar GREEN**

Run:

```bash
npx vitest run src/services/__tests__/reviewGateHardeningMigration.test.ts src/services/__tests__/reviewGateCanonicalMigration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/__tests__/reviewGateHardeningMigration.test.ts supabase/migrations/20260619130000_review_gate_hardening.sql
git commit -m "fix(db): endurece gate de revisao e faturamento"
```

### Task 2: Corrigir os contratos TypeScript e importação BB

**Files:**
- Modify: `src/services/review.ts`
- Modify: `src/services/__tests__/review.test.ts`
- Modify: `src/services/breakbulkImport.ts`
- Modify: `src/services/__tests__/breakbulkImport.test.ts`
- Modify: `src/types/database.ts`

- [ ] **Step 1: Escrever testes falhos do payload de revisão**

Adicionar em `review.test.ts` um caso de sucesso e verificar:

```ts
expect(rpcArgs.p_update_payload).not.toHaveProperty('review_status')
expect(rpcArgs.p_audit_rows).not.toEqual(
  expect.arrayContaining([expect.objectContaining({ field_name: 'review_status' })]),
)
```

- [ ] **Step 2: Escrever teste falho da importação BB**

No teste de persistência BB:

```ts
expect(mockRpc).toHaveBeenCalledWith('apply_bl_review_gate_after_import', {
  p_bl_ids: ['BB001'],
  p_changed_by: '00000000-0000-0000-0000-000000000001',
})
```

- [ ] **Step 3: Confirmar RED**

Run:

```bash
npx vitest run src/services/__tests__/review.test.ts src/services/__tests__/breakbulkImport.test.ts
```

Expected: FAIL porque o cliente ainda fabrica status e o importador BB ainda não
chama o gate.

- [ ] **Step 4: Implementar o mínimo**

Em `review.ts`, iniciar payload vazio e manter apenas alterações reais:

```ts
const updatePayload: Record<string, unknown> = {}
```

Remover as audit rows de `review_status` de `saveBlReview` e
`applyInlineBlReviewFix`.

Em `breakbulkImport.ts`, depois do upsert e antes do cálculo:

```ts
const { error: gateError } = await supabase.rpc('apply_bl_review_gate_after_import', {
  p_bl_ids: validBlIds,
  p_changed_by: uploadedBy,
})
if (gateError) throw gateError
```

Atualizar `Database['public']['Functions']`:

```ts
save_bl_review: {
  Args: { ... }
  Returns: Json
}
apply_bl_review_gate_after_import: {
  Args: { p_bl_ids: string[]; p_changed_by: string }
  Returns: number
}
```

- [ ] **Step 5: Confirmar GREEN**

Run:

```bash
npx vitest run src/services/__tests__/review.test.ts src/services/__tests__/breakbulkImport.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/review.ts src/services/__tests__/review.test.ts src/services/breakbulkImport.ts src/services/__tests__/breakbulkImport.test.ts src/types/database.ts
git commit -m "fix(revisao): usa status canonico retornado pelo banco"
```

### Task 3: Remover dependência RLS da fila e tornar provisionamento recuperável

**Files:**
- Modify: `src/hooks/useReview.ts`
- Modify: `src/pages/revisaoHelpers.ts`
- Modify: `src/pages/__tests__/revisaoHelpers.test.ts`
- Modify: `src/services/customers.ts`
- Modify: `src/services/__tests__/customers.test.ts`
- Modify: `src/pages/__tests__/Revisao.test.tsx`

- [ ] **Step 1: Escrever teste falho de motivos canônicos**

Em `revisaoHelpers.test.ts`, criar itens com `review_reasons` e provar:

```ts
expect(groupNeedsEmail(groupWithEmailReason)).toBe(true)
expect(groupNeedsPortal(groupWithPortalReason)).toBe(true)
expect(groupNeedsPortal(groupWithoutPortalReason)).toBe(false)
```

O teste não deve preencher `customer_portal_accounts`.

- [ ] **Step 2: Escrever testes falhos de provisionamento**

Mockar `supabase.functions.invoke` e verificar a ordem:

```ts
expect(mockRpc).toHaveBeenNthCalledWith(1, 'upsert_customer_portal_account', expect.objectContaining({
  p_active: false,
}))
expect(mockInvoke).toHaveBeenCalled()
expect(mockRpc).toHaveBeenNthCalledWith(2, 'set_customer_portal_account_active', expect.objectContaining({
  p_active: true,
}))
```

Para falha da Edge Function:

```ts
await expect(provisionPortalForCustomer(input)).rejects.toThrow('email ja utilizado')
expect(mockRpc).not.toHaveBeenCalledWith(
  'set_customer_portal_account_active',
  expect.objectContaining({ p_active: true }),
)
```

Também exigir erro quando a resposta de sucesso não contiver `auth_user_id`.

- [ ] **Step 3: Confirmar RED**

Run:

```bash
npx vitest run src/pages/__tests__/revisaoHelpers.test.ts src/services/__tests__/customers.test.ts src/pages/__tests__/Revisao.test.tsx
```

Expected: FAIL pelos joins admin-only e ativação antes do Auth.

- [ ] **Step 4: Implementar o mínimo**

Em `useReview.ts`, manter apenas:

```ts
customer:customers(id, cnpj_cpf, name, customer_contacts(email))
```

Remover `customer_portal_accounts` do tipo `ReviewCustomer`.

Em `revisaoHelpers.ts`, derivar as ações das razões:

```ts
export function groupNeedsEmail(group: ReviewGroup) {
  return group.items.some((item) =>
    (item.review_reasons ?? []).some((reason) => /cliente sem e-mail cadastrado/i.test(reason)),
  )
}

export function groupNeedsPortal(group: ReviewGroup) {
  return group.items.some((item) =>
    (item.review_reasons ?? []).some((reason) => /acesso ao portal nao provisionado/i.test(reason)),
  )
}
```

Em `customers.ts`, provisionar em três etapas:

```ts
const account = await upsertCustomerPortalAccount({ ...input, active: false })
const authResult = await provisionPortalAuthUser({ accountId: account.id, portalEmail, password })
if (!authResult.auth_user_id) throw new Error('Provisionamento do portal nao retornou usuario Auth.')
await setCustomerPortalAccountActive({ customerId, active: true, actorId })
```

Atualizar `CustomerPortalAccount` com `auth_user_id` e `portal_email`.

- [ ] **Step 5: Confirmar GREEN**

Run:

```bash
npx vitest run src/pages/__tests__/revisaoHelpers.test.ts src/services/__tests__/customers.test.ts src/pages/__tests__/Revisao.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useReview.ts src/pages/revisaoHelpers.ts src/pages/__tests__/revisaoHelpers.test.ts src/services/customers.ts src/services/__tests__/customers.test.ts src/pages/__tests__/Revisao.test.tsx
git commit -m "fix(portal): ativa acesso somente apos vinculo Auth"
```

### Task 4: Alinhar documentação viva

**Files:**
- Modify: `docs/adr/0006-revisao-operacional-reconciliacao-cliente-gate-faturamento.md`
- Modify: `docs/modules/operacao-suporte.md`
- Modify: `docs/operations/regras-de-negocio.md`
- Modify: `docs/operations/seguranca.md`
- Modify: `docs/operations/validacao.md`
- Modify: `docs/CHANGELOG.md`

- [ ] **Step 1: Atualizar a definição vigente**

Documentar explicitamente:

- portal provisionado = `active = true` e `auth_user_id` preenchido;
- `save_bl_review` preserva reconciliação, billing hold, fila e auditoria real;
- importação CNTR e BB aplica gate antes de promover/faturar;
- `mark_bl_ready_for_billing` e o trigger final impedem bypass;
- usuários não-admin veem motivos canônicos sem ler
  `customer_portal_accounts`;
- provisionamento fica inativo até confirmação da Edge Function;
- rollout não reabre B/Ls já faturados e não possui backfill.

- [ ] **Step 2: Acrescentar validação operacional**

Adicionar casos:

```text
1. importar B/L com cliente e e-mail, mas sem conta Auth;
2. confirmar pending_review e motivo de portal;
3. tentar marcar ready_for_billing diretamente e confirmar bloqueio;
4. provisionar portal com admin e confirmar saída da fila;
5. simular erro da Edge Function e confirmar conta inativa;
6. validar a fila com perfil operacoes/documentacao sem erro de RLS;
7. confirmar que B/L já faturado não foi reaberto pela migration.
```

- [ ] **Step 3: Verificar documentação**

Run:

```bash
npm run docs:check
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/adr/0006-revisao-operacional-reconciliacao-cliente-gate-faturamento.md docs/modules/operacao-suporte.md docs/operations/regras-de-negocio.md docs/operations/seguranca.md docs/operations/validacao.md docs/CHANGELOG.md
git commit -m "docs: corrige contrato do gate de revisao"
```

### Task 5: Verificação final e auditoria de conclusão

**Files:**
- Modify only if a verification failure is directly caused by Tasks 1–4.

- [ ] **Step 1: Rodar a suíte focada**

```bash
npx vitest run \
  src/services/__tests__/reviewGateHardeningMigration.test.ts \
  src/services/__tests__/reviewGateCanonicalMigration.test.ts \
  src/services/__tests__/review.test.ts \
  src/services/__tests__/breakbulkImport.test.ts \
  src/services/__tests__/customers.test.ts \
  src/pages/__tests__/revisaoHelpers.test.ts \
  src/pages/__tests__/Revisao.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Rodar todos os gates locais**

```bash
npm run docs:check
npm run lint
npm test
npm run build
git diff --check origin/main...HEAD
```

Expected: exit code 0 em todos.

- [ ] **Step 3: Auditar ausência de backfill e grants**

```bash
rg -n "UPDATE public\\.bls|REVOKE|GRANT|auth_user_id|sync_customer_reconciliation_queue_for_bl" \
  supabase/migrations/20260619130000_review_gate_hardening.sql
```

Confirmar manualmente que todo `UPDATE public.bls` está dentro de função e que
não existe comando top-level que reabra históricos.

- [ ] **Step 4: Revisar diff**

```bash
git status --short
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
```

Cada arquivo alterado deve corresponder a um finding ou à documentação exigida.
