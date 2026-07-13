# Open Issues Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 open GitHub issues: remove dead redirect code, add missing navigation, and remove a frontend/backend restriction for POD omission.

> **Status:** concluído. Implementado nos commits `e5d2a27`, `bcf5a52`, `ca7f2e6` e `6471ba6`, cobrindo as issues #355–#359.

**Architecture:** Each issue is independent. Tasks 1-3 are pure deletion/cleanup. Task 4 touches frontend guard, modal logic, and requires a new Supabase migration to relax the backend constraint. Task 5 is a one-line nav entry.

**Tech Stack:** React, React Router, Supabase (PostgreSQL RPC + migrations), TypeScript

**Scope note:** Issues #358 and #356 are duplicates (both remove LineUpTV.tsx). Handled as a single task.

---

## File Structure

| File | Action | Reason |
|------|--------|--------|
| `src/pages/VaziosRedirect.tsx` | Delete | Dead code — route uses inline `<Navigate>` |
| `src/pages/__tests__/VaziosRedirect.test.tsx` | Delete | Tests dead component |
| `src/pages/LineUpTV.tsx` | Delete | Dead redirect to `/painel` |
| `src/pages/__tests__/LineUpTV.behavior.test.tsx` | Delete | Tests dead component + LineUpTVDisplay tests that belong elsewhere |
| `src/App.tsx` | Modify | Remove LineUpTV lazy import + route (lines 32, 104) |
| `src/lib/pageTitle.ts` | Modify | Remove LineUpTV title entries (lines 16-17) |
| `src/components/layout/appLayoutNav.ts` | Modify | Add GraniteRates nav entry |
| `src/pages/Granite.tsx` | Modify | Make "Acesse Granito > Taxas" text a clickable link |
| `src/components/voyages/VoyageVisaoTab.tsx` | Modify | Remove `activePods.length > 1` guard on omit button |
| `src/components/voyages/VoyageCard.tsx` | Modify | Fix `candidateDischargePods` for single-POD case |
| `supabase/migrations/NNN_relax_omit_single_pod.sql` | Create | New migration: relax RPC + CHECK constraint |

---

## Task 1: Remove dead VaziosRedirect (Issue #359)

**Files:**
- Delete: `src/pages/VaziosRedirect.tsx`
- Delete: `src/pages/__tests__/VaziosRedirect.test.tsx`

- [ ] **Step 1: Verify no imports reference VaziosRedirect**

Run: `rg "VaziosRedirect" src/`
Expected: Only hits in the two files being deleted (definition + test). No imports elsewhere.

- [ ] **Step 2: Delete the component and test**

```bash
git rm src/pages/VaziosRedirect.tsx src/pages/__tests__/VaziosRedirect.test.tsx
```

- [ ] **Step 3: Run tests to verify nothing breaks**

Run: `npm test -- --watchAll=false 2>&1 | head -50`
Expected: All tests pass (the deleted test no longer runs).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove dead VaziosRedirect component (#359)"
```

---

## Task 2: Remove dead LineUpTV redirect (Issues #356 + #358)

**Files:**
- Delete: `src/pages/LineUpTV.tsx`
- Delete: `src/pages/__tests__/LineUpTV.behavior.test.tsx`
- Modify: `src/App.tsx` (remove lazy import line 32, remove route line 104)
- Modify: `src/lib/pageTitle.ts` (remove lines 16-17)

- [ ] **Step 1: Verify no other imports reference LineUpTV (the redirect component)**

Run: `rg "LineUpTV[^D]" src/` (exclude LineUpTVDisplay)
Expected: Hits in App.tsx (import + route), LineUpTV.tsx, and the test file. No other consumers.

- [ ] **Step 2: Delete the component and test**

```bash
git rm src/pages/LineUpTV.tsx src/pages/__tests__/LineUpTV.behavior.test.tsx
```

- [ ] **Step 3: Remove lazy import and route from App.tsx**

In `src/App.tsx`, remove line 32:
```tsx
const LineUpTV = lazyPage(() => import('./pages/LineUpTV'), 'LineUpTV')
```

Remove line 104:
```tsx
<Route path="/line-up-tv" element={withSuspense(<LineUpTV />)} />
```

- [ ] **Step 4: Remove title entries from pageTitle.ts**

In `src/lib/pageTitle.ts`, remove lines 16-17:
```tsx
[/^\/line-up-tv\/display/, 'Line-Up TV'],
[/^\/line-up-tv/, 'Line-Up TV'],
```

- [ ] **Step 5: Run tests**

Run: `npm test -- --watchAll=false 2>&1 | head -50`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove dead LineUpTV redirect route (#356, #358)"
```

---

## Task 3: Add navigation for GraniteRates (Issue #357)

**Files:**
- Modify: `src/components/layout/appLayoutNav.ts` (add nav item)
- Modify: `src/pages/Granite.tsx` (make text a link)

- [ ] **Step 1: Add GraniteRates to exportNavItems**

In `src/components/layout/appLayoutNav.ts`, add a nav entry after the Granito item:

```ts
export const exportNavItems: NavItem[] = [
  { to: '/granito', label: 'Granito', icon: Mountain },
  { to: '/granito/taxas', label: 'Taxas Granito', icon: Mountain },  // ADD THIS
  { to: '/embarquevazios', label: 'Vazios EXP', icon: Package },
]
```

- [ ] **Step 2: Make "Acesse Granito > Taxas" a clickable link**

In `src/pages/Granite.tsx`, find line 303:
```tsx
<p className="app-panel__meta">Nenhuma taxa ativa cadastrada. Acesse Granito &gt; Taxas para cadastrar.</p>
```

Replace with:
```tsx
<p className="app-panel__meta">Nenhuma taxa ativa cadastrada. <a href="/granito/taxas">Acesse Granito &gt; Taxas</a> para cadastrar.</p>
```

- [ ] **Step 3: Run tests**

Run: `npm test -- --watchAll=false 2>&1 | head -50`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/appLayoutNav.ts src/pages/Granite.tsx
git commit -m "feat: add GraniteRates navigation link (#357)"
```

---

## Task 4: Remove POD alternative restriction for scale omission (Issue #355)

**Files:**
- Create: `supabase/migrations/NNN_relax_omit_single_pod.sql`
- Modify: `src/components/voyages/VoyageVisaoTab.tsx` (line 246)
- Modify: `src/components/voyages/VoyageCard.tsx` (line 352)

- [ ] **Step 1: Create new migration to relax the CHECK constraint and RPC validation**

First, find the latest migration number:

Run: `ls supabase/migrations/ | sort -n | tail -1`
Expected: Something like `175_portal_ship_schedule_hide_omitted.sql` or higher.

Then create `supabase/migrations/NNN_relax_omit_single_pod.sql` (use the next number):

```sql
-- Migration: Relax omit_voyage_escala to allow single-POD omission
-- Issue #355: The omitted POD is the final cargo destination; discharge happens
-- at a transshipment port managed by another vessel. No alternate POD needed.

-- 1. Drop the CHECK constraint that prevents omitted_pod = discharge_pod
ALTER TABLE public.voyage_omissions
  DROP CONSTRAINT IF EXISTS voyage_omissions_omitted_pod_discharge_pod_check;

-- 2. Update the RPC to accept omitted_pod = discharge_pod
CREATE OR REPLACE FUNCTION public.omit_voyage_escala(
  p_voyage_id BIGINT,
  p_omitted_pod TEXT,
  p_discharge_pod TEXT,
  p_reason TEXT,
  p_changed_by UUID
) RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
DECLARE
  v_omitted TEXT := upper(btrim(p_omitted_pod));
  v_discharge TEXT := upper(btrim(p_discharge_pod));
  v_omission_id BIGINT;
  v_bl RECORD;
BEGIN
  IF v_omitted = '' OR v_discharge = '' THEN
    RAISE EXCEPTION 'POD omitido/descarga invalidos' USING ERRCODE = '22023';
  END IF;

  -- Allow omitted_pod = discharge_pod for single-POD transshipment cases

  INSERT INTO public.voyage_omissions (voyage_id, omitted_pod, discharge_pod, reason, changed_by)
  VALUES (p_voyage_id, v_omitted, v_discharge, p_reason, p_changed_by)
  RETURNING id INTO v_omission_id;

  -- Audit log: mark the omitted pod
  INSERT INTO public.audit_logs (table_name, record_id, field_name, old_value, new_value, changed_by)
  SELECT 'voyage_route_schedules', id, 'omitted', 'false', 'true', p_changed_by
  FROM public.voyage_route_schedules
  WHERE voyage_id = p_voyage_id AND upper(btrim(pod)) = v_omitted;

  UPDATE public.voyage_route_schedules
  SET omitted = true
  WHERE voyage_id = p_voyage_id AND upper(btrim(pod)) = v_omitted;

  -- Audit: voyage-level escala omitida
  INSERT INTO public.audit_logs (table_name, record_id, field_name, old_value, new_value, changed_by)
  VALUES ('voyages', p_voyage_id, 'escala_omitida', NULL, v_omitted, p_changed_by);

  -- Create bl_transshipments for each B/L of the omitted POD
  FOR v_bl IN
    SELECT bl.id AS bl_id
    FROM public.bls bl
    JOIN public.bl_voyage_schedules bvs ON bvs.bl_id = bl.id
    WHERE bvs.voyage_id = p_voyage_id
      AND upper(btrim(bvs.pod)) = v_omitted
  LOOP
    INSERT INTO public.bl_transshipments (bl_id, omission_id, disposition, discharge_pod, loaded_on_voyage_id)
    VALUES (v_bl.bl_id, v_omission_id, 'transshipment', v_discharge, NULL)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Portal notifications for affected B/Ls
  INSERT INTO public.portal_notifications (bl_id, notification_type, message)
  SELECT bl.id, 'transshipment', 'Escala omitida: ' || v_omitted || ' -> ' || v_discharge
  FROM public.bls bl
  JOIN public.bl_voyage_schedules bvs ON bvs.bl_id = bl.id
  WHERE bvs.voyage_id = p_voyage_id
    AND upper(btrim(bvs.pod)) = v_omitted;

  RETURN v_omission_id;
END;
$$;

-- Re-grant permissions
REVOKE ALL ON FUNCTION public.omit_voyage_escala(BIGINT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omit_voyage_escala(BIGINT, TEXT, TEXT, TEXT, UUID) TO authenticated;
```

- [ ] **Step 2: Remove the activePods guard on the omit button**

In `src/components/voyages/VoyageVisaoTab.tsx`, find line 246:
```tsx
{!row.omitted && activePods.filter((pod) => normalizePortName(pod) !== normalizePortName(row.pod)).length > 0 ? (
```

Replace with:
```tsx
{!row.omitted ? (
```

- [ ] **Step 3: Fix candidateDischargePods for single-POD case**

In `src/components/voyages/VoyageCard.tsx`, find line 352:
```tsx
candidateDischargePods={activePods.filter((pod) => pod !== omitTarget)}
```

Replace with:
```tsx
candidateDischargePods={activePods.length > 1 ? activePods.filter((pod) => pod !== omitTarget) : activePods}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --watchAll=false 2>&1 | head -50`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/voyages/VoyageVisaoTab.tsx src/components/voyages/VoyageCard.tsx supabase/migrations/
git commit -m "fix: allow POD omission with single active POD (#355)"
```

---

## Task 5: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm test -- --watchAll=false`
Expected: All tests pass.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck` (or `npx tsc --noEmit`)
Expected: No type errors.

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Run docs check**

Run: `npm run docs:check`
Expected: No broken references.

---

## Self-Review

**1. Spec coverage:**
- #359 (VaziosRedirect): Task 1 ✓
- #356 + #358 (LineUpTV): Task 2 ✓
- #357 (GraniteRates nav): Task 3 ✓
- #355 (POD omission): Task 4 ✓

**2. Placeholder scan:** No TBDs, no "add later", no "similar to Task N". All steps have exact code.

**3. Type consistency:** `candidateDischargePods` is `string[]` in both VoyageCard and OmitEscalaModal. `activePods` is `string[]` in both VoyageVisaoTab and VoyageCard. RPC signature unchanged (still `BIGINT, TEXT, TEXT, TEXT, UUID`).
