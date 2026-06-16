# Portal CE Mercante Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the approved CE Mercante gate across all customer portal RPCs so BLs, containers, invoices, demurrage, receivables, and consolidation actions are visible/actionable only after the related BL has CE Mercante.

**Architecture:** Add one SQL helper, `public.bl_has_portal_release(text)`, and redefine the portal RPCs that expose operational, local billing, consolidation, and demurrage data. Keep internal billing/calculation flows unchanged. Verify with static migration contract tests because the Supabase CLI is not installed in this environment.

**Tech Stack:** Supabase Postgres migrations, PL/pgSQL RPCs, React/Vite existing portal services, Vitest static SQL contract tests.

---

## File Structure

- Create: `src/services/__tests__/portalCeMercanteGateMigration.test.ts`
  - Owns the migration contract tests for the CE Mercante portal gate.
- Create: `supabase/migrations/20260615220000_portal_ce_mercante_gate.sql`
  - Adds the helper and redefines affected portal RPCs.
- Keep unchanged: portal React pages and services.
  - They already consume portal RPCs; the visibility rule belongs at the database boundary.

---

### Task 1: Migration Contract Tests

**Files:**
- Create: `src/services/__tests__/portalCeMercanteGateMigration.test.ts`
- Test: `src/services/__tests__/portalCeMercanteGateMigration.test.ts`

- [x] **Step 1: Write the failing migration test**

Create `src/services/__tests__/portalCeMercanteGateMigration.test.ts` with tests that read the newest `_portal_ce_mercante_gate.sql` migration and assert:

```ts
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readGateMigration() {
  const dir = resolve(process.cwd(), 'supabase/migrations')
  const file = readdirSync(dir)
    .filter((name) => name.endsWith('_portal_ce_mercante_gate.sql'))
    .sort()
    .at(-1)

  expect(file).toBeTruthy()

  const path = resolve(dir, file!)
  expect(existsSync(path)).toBe(true)
  return readFileSync(path, 'utf8')
}

function squash(sql: string) {
  return sql.replace(/\s+/g, ' ')
}

describe('portal CE Mercante gate migration', () => {
  const sql = readGateMigration()
  const compactSql = squash(sql)

  it('defines a central BL portal release helper based on non-empty CE Mercante', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.bl_has_portal_release\(p_bl_id TEXT\)/)
    expect(compactSql).toMatch(/RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER/)
    expect(sql).toContain("SET search_path TO 'public', 'pg_temp'")
    expect(compactSql).toMatch(/trim\(coalesce\(b\.ce_mercante,\s*''\)\)\s*<>\s*''/)
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bl_has_portal_release(TEXT) FROM PUBLIC;')
  })

  it('filters operational BLs and portal receivables through the helper', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_list_operation_bls\(\)/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_list_consolidatable_receivables\(\)/)
    expect(compactSql).toMatch(/WHERE b\.customer_id = v_customer_id AND public\.bl_has_portal_release\(b\.id\)/)
    expect(compactSql).toMatch(/WHERE br\.customer_id = v_customer_id AND br\.source = 'local_charges' AND public\.bl_has_portal_release\(br\.bl_id\)/)
  })

  it('guards portal consolidation creation against receivables without CE Mercante', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_create_consolidation\(p_receivable_ids BIGINT\[\]\)/)
    expect(sql).toContain("public.check_portal_rate_limit('create_consolidation', 3, 10)")
    expect(sql).toContain("RAISE EXCEPTION 'Selecao contem B/L sem CE Mercante liberado para o portal.'")
    expect(compactSql).toMatch(/FROM public\.bl_receivables AS br WHERE br\.id = ANY\(v_ids\) AND NOT public\.bl_has_portal_release\(br\.bl_id\)/)
  })

  it('requires all linked BLs to be released before listing or detailing local invoices', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_list_invoices\(\)/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_invoice_details\(p_invoice_id bigint\)/)
    expect(sql).toContain('linked_invoice_bls AS')
    expect(sql).toContain('eligible_invoices AS')
    expect(compactSql).toMatch(/SELECT ib\.invoice_id, ib\.bl_id FROM public\.invoice_bls AS ib UNION SELECT irl\.invoice_id, irl\.bl_id FROM public\.invoice_receivable_links AS irl WHERE irl\.status = 'active'/)
    expect(compactSql).toMatch(/EXISTS \( SELECT 1 FROM linked_invoice_bls AS linked WHERE linked\.invoice_id = i\.id \)/)
    expect(compactSql).toMatch(/NOT EXISTS \( SELECT 1 FROM linked_invoice_bls AS linked WHERE linked\.invoice_id = i\.id AND NOT public\.bl_has_portal_release\(linked\.bl_id\) \)/)
    expect(compactSql).toMatch(/JOIN eligible_invoices AS eligible ON eligible\.invoice_id = i\.id/)
  })

  it('gates portal demurrage list and detail by the BL CE Mercante', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_list_demurrage_invoices\(\)/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_get_demurrage_invoice_detail\(p_invoice_id bigint\)/)
    expect(compactSql).toMatch(/WHERE di\.customer_id = v_customer_id AND di\.status IN \('issued', 'overdue', 'paid'\) AND public\.bl_has_portal_release\(di\.bl_id\)/)
  })
})
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run test -- src/services/__tests__/portalCeMercanteGateMigration.test.ts
```

Expected: FAIL because no `_portal_ce_mercante_gate.sql` migration exists.

---

### Task 2: Portal CE Mercante Gate Migration

**Files:**
- Create: `supabase/migrations/20260615220000_portal_ce_mercante_gate.sql`
- Test: `src/services/__tests__/portalCeMercanteGateMigration.test.ts`

- [x] **Step 1: Implement the migration**

Create `supabase/migrations/20260615220000_portal_ce_mercante_gate.sql` with:

- `public.bl_has_portal_release(p_bl_id TEXT)`.
- Redefinition of:
  - `portal_list_operation_bls()`.
  - `portal_list_consolidatable_receivables()`.
  - `portal_create_consolidation(BIGINT[])`.
  - `portal_list_invoices()`.
  - `portal_invoice_details(bigint)`.
  - `portal_list_demurrage_invoices()`.
  - `portal_get_demurrage_invoice_detail(bigint)`.

The migration must preserve current RPC return contracts and add only the CE Mercante release gate.

- [x] **Step 2: Run focused migration tests and verify GREEN**

Run:

```bash
npm run test -- src/services/__tests__/portalCeMercanteGateMigration.test.ts src/services/__tests__/portalOperationMigration.test.ts src/services/__tests__/portalInvoiceConsolidatedBreakdownMigration.test.ts src/services/__tests__/portalCreateConsolidationJsonbMigration.test.ts
```

Expected: PASS.

---

### Task 3: Portal Regression Verification

**Files:**
- Test only.

- [x] **Step 1: Run portal page tests**

Run:

```bash
npm run test -- src/pages/__tests__/PortalDashboard.test.tsx src/pages/__tests__/PortalBilling.test.tsx src/pages/__tests__/PortalOperacao.test.tsx
```

Expected: PASS.

- [x] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [x] **Step 3: Review diff against the spec**

Run:

```bash
git diff --stat
git diff -- src/services/__tests__/portalCeMercanteGateMigration.test.ts supabase/migrations/20260615220000_portal_ce_mercante_gate.sql
```

Expected: Only the migration contract test, migration, and this plan are changed.
