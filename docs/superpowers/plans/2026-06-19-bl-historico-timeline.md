# BL Histórico timeline (`bl_timeline` RPC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Histórico tab into a full B/L lifecycle timeline, assembled by a server-side `bl_timeline(bl_id)` RPC and rendered as humanized, paginated events.

**Architecture:** A `SECURITY DEFINER` SQL function UNIONs `audit_logs` rows from the families that resolve to a B/L (`bl`, `bl_container`, `charge_calculation`/`charge_status`, `invoice`, and `system_event` rows whose `entity_id` is the B/L). A React Query hook paginates it; a presentation map turns `(entity_type, field_name)` into readable phrases with a family badge.

**Tech Stack:** Supabase/Postgres (SQL migration), React + TanStack Query v5, Vitest.

This is Plan 3 of 3 (Componente G). Depends on Plan 2 (3-tab structure) for the Histórico tab host. Follow `.claude/skills/supabase-migration.skill` (RLS-first, rollback note, `list_tables` before editing) and `.claude/skills/react-query-pattern.skill`.

**Safety note:** The `audit_logs` SELECT policy (`audit_logs_select_active`) already lets any active user read every audit row. Filtering to one B/L exposes a **subset** of that — so `SECURITY DEFINER` + an `is_active_user()` guard adds no new exposure while letting the function resolve `bl_id` via joins regardless of the joined tables' own RLS.

---

## File Structure

- Create: `supabase/migrations/20260619140000_bl_timeline_rpc.sql` — the RPC.
- Create: `src/services/blTimeline.ts` — service fn `fetchBlTimeline(blId, limit, offset)`.
- Create: `src/hooks/useBlTimeline.ts` — `useInfiniteQuery` hook + cache key.
- Create: `src/components/bl/blTimelinePresentation.ts` — `(entity_type, field_name) → { family, label, phrase }`.
- Create: `src/components/bl/BlHistoricoTab.tsx` — the tab UI (badges + "carregar mais").
- Modify: `src/services/queryKeys.ts` — add `bls.timeline(blId)`.
- Modify: `src/pages/BlDetalhe.tsx` — replace the inline Histórico block with `<BlHistoricoTab>`; drop `useAuditLogs('bl', …)` usage there.
- Test: `src/components/bl/__tests__/blTimelinePresentation.test.ts`.

---

## Task 1: Confirm `entity_id` semantics per family (discovery)

**Files:** none (read-only DB inspection)

- [ ] **Step 1: Inspect the schema and real keys**

Use the Supabase MCP `list_tables` then `execute_sql` (read-only) to confirm join columns and `entity_id` shapes:

```sql
-- join columns exist?
SELECT 1 FROM information_schema.columns WHERE table_name='charge_calculations' AND column_name='bl_id';
SELECT 1 FROM information_schema.columns WHERE table_name='invoice_bls' AND column_name IN ('bl_id','invoice_id');
SELECT 1 FROM information_schema.columns WHERE table_name='bl_containers' AND column_name='bl_id';

-- how is entity_id keyed per family? (sample)
SELECT entity_type, count(*),
       min(entity_id) AS sample_id
FROM public.audit_logs
WHERE entity_type IN ('bl','bl_container','charge_calculation','charge_status','invoice','system_event')
GROUP BY entity_type;
```

- [ ] **Step 2: Record findings**

Document, in the migration's header comment, the confirmed keying:
- `bl` → `entity_id = bls.id` (text)
- `bl_container` → `entity_id = bl_containers.id::text`
- `charge_calculation` → `entity_id = charge_calculations.id::text`
- `charge_status` → confirm whether keyed by `bls.id` or `charge_calculations.id`; the migration WHERE clause in Task 2 must match what you find. Default assumption: same as `charge_calculation` (calc id). If it is `bls.id`, add an explicit `OR (entity_type='charge_status' AND entity_id = p_bl_id)` branch.
- `invoice` → `entity_id = invoices.id::text`, resolved to B/L via `invoice_bls`.
- `system_event` → include only rows with `entity_id = p_bl_id` (e.g. `bl_review_concurrent_conflict`); exclude globals like `'billing'`.

No commit (discovery only).

---

## Task 2: Create the `bl_timeline` RPC migration

**Files:**
- Create: `supabase/migrations/20260619140000_bl_timeline_rpc.sql`

- [ ] **Step 1: Write the migration (adjust the `charge_status` branch per Task 1)**

```sql
-- 20260619140000_bl_timeline_rpc.sql
-- Linha do tempo do B/L: consolida famílias de audit_logs que resolvem a um
-- B/L. SECURITY DEFINER + guard is_active_user() — não expõe mais do que a
-- policy audit_logs_select_active já permite (leitura de todos os audit_logs
-- por usuário ativo); apenas filtra para um B/L resolvendo entity_id via joins.
-- Rollback: DROP FUNCTION public.bl_timeline(TEXT, INT, INT);

CREATE OR REPLACE FUNCTION public.bl_timeline(
  p_bl_id TEXT,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id BIGINT,
  family TEXT,
  entity_type TEXT,
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  changed_by UUID,
  changed_at TIMESTAMPTZ,
  justification TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    a.id,
    CASE a.entity_type
      WHEN 'bl' THEN 'edicao'
      WHEN 'bl_container' THEN 'container'
      WHEN 'charge_calculation' THEN 'taxas'
      WHEN 'charge_status' THEN 'taxas'
      WHEN 'invoice' THEN 'fatura'
      ELSE 'sistema'
    END AS family,
    a.entity_type, a.field_name, a.old_value, a.new_value,
    a.changed_by, a.changed_at, a.justification
  FROM public.audit_logs a
  WHERE public.is_active_user()
    AND (
      (a.entity_type = 'bl' AND a.entity_id = p_bl_id)
      OR (a.entity_type = 'bl_container' AND a.entity_id IN (
            SELECT c.id::text FROM public.bl_containers c WHERE c.bl_id = p_bl_id))
      OR (a.entity_type IN ('charge_calculation','charge_status') AND a.entity_id IN (
            SELECT cc.id::text FROM public.charge_calculations cc WHERE cc.bl_id = p_bl_id))
      OR (a.entity_type = 'invoice' AND a.entity_id IN (
            SELECT ib.invoice_id::text FROM public.invoice_bls ib WHERE ib.bl_id = p_bl_id))
      OR (a.entity_type = 'system_event' AND a.entity_id = p_bl_id)
    )
  ORDER BY a.changed_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 50), 0)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

REVOKE ALL ON FUNCTION public.bl_timeline(TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bl_timeline(TEXT, INT, INT) TO authenticated;
```

- [ ] **Step 2: Apply and smoke-test against a real B/L**

Apply via Supabase MCP `apply_migration` (or `supabase db push`). Then `execute_sql`:

```sql
SELECT family, entity_type, field_name, changed_at
FROM public.bl_timeline('<um_bl_id_real>', 20, 0)
ORDER BY changed_at DESC;
```

Expected: rows from multiple families (at least `edicao`), newest first; no `system_event` with `entity_id='billing'`.

- [ ] **Step 3: Regenerate DB types (protected file — get authorization)**

`src/types/database.ts` is guard-protected. With authorization, regenerate via the Supabase types generator and add the `bl_timeline` function signature, or hand-add a return-row type in `src/services/blTimeline.ts` (Task 3) to avoid touching the protected file. Prefer the latter to stay within the guard.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260619140000_bl_timeline_rpc.sql
git commit -m "feat(db): bl_timeline RPC consolidating audit families per B/L"
```

---

## Task 3: Service + hook (`fetchBlTimeline`, `useBlTimeline`)

**Files:**
- Create: `src/services/blTimeline.ts`
- Create: `src/hooks/useBlTimeline.ts`
- Modify: `src/services/queryKeys.ts`

- [ ] **Step 1: Add the cache key**

In `src/services/queryKeys.ts`, inside the `bls` object:

```ts
    timeline: (blId: string) => ['bl-timeline', blId] as const,
```

- [ ] **Step 2: Service function + row type**

```ts
// src/services/blTimeline.ts
import { supabase } from './supabase'

export type BlTimelineFamily = 'edicao' | 'container' | 'taxas' | 'fatura' | 'sistema'

export type BlTimelineEvent = {
  id: number
  family: BlTimelineFamily
  entity_type: string
  field_name: string
  old_value: string | null
  new_value: string | null
  changed_by: string | null
  changed_at: string | null
  justification: string | null
}

export const BL_TIMELINE_PAGE_SIZE = 50

export async function fetchBlTimeline(blId: string, offset: number): Promise<BlTimelineEvent[]> {
  const { data, error } = await supabase.rpc('bl_timeline', {
    p_bl_id: blId,
    p_limit: BL_TIMELINE_PAGE_SIZE,
    p_offset: offset,
  })
  if (error) throw error
  return (data ?? []) as BlTimelineEvent[]
}
```

- [ ] **Step 3: Infinite-query hook**

```ts
// src/hooks/useBlTimeline.ts
import { useInfiniteQuery } from '@tanstack/react-query'
import { queryKeys } from '../services/queryKeys'
import { BL_TIMELINE_PAGE_SIZE, fetchBlTimeline } from '../services/blTimeline'

export function useBlTimeline(blId?: string) {
  return useInfiniteQuery({
    queryKey: blId ? queryKeys.bls.timeline(blId) : ['bl-timeline', 'nil'],
    enabled: Boolean(blId),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchBlTimeline(blId!, pageParam as number),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === BL_TIMELINE_PAGE_SIZE ? allPages.length * BL_TIMELINE_PAGE_SIZE : undefined,
  })
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/blTimeline.ts src/hooks/useBlTimeline.ts src/services/queryKeys.ts
git commit -m "feat(bl): bl_timeline service + useBlTimeline infinite hook"
```

---

## Task 4: Humanized presentation map

**Files:**
- Create: `src/components/bl/blTimelinePresentation.ts`
- Test: `src/components/bl/__tests__/blTimelinePresentation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/bl/__tests__/blTimelinePresentation.test.ts
import { describe, expect, it } from 'vitest'
import { describeTimelineEvent, familyLabel } from '../blTimelinePresentation'

describe('describeTimelineEvent', () => {
  it('humanizes a field edit', () => {
    const e = { family: 'edicao', entity_type: 'bl', field_name: 'notify_party', old_value: 'X', new_value: 'Y', justification: 'ajuste' } as never
    expect(describeTimelineEvent(e)).toBe('notify_party: X → Y')
  })
  it('humanizes an invoice issuance', () => {
    const e = { family: 'fatura', entity_type: 'invoice', field_name: 'status', old_value: 'pending', new_value: 'issued', justification: null } as never
    expect(describeTimelineEvent(e)).toMatch(/Fatura/i)
  })
  it('maps family labels', () => {
    expect(familyLabel('taxas')).toBe('Taxas')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/bl/__tests__/blTimelinePresentation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the presentation map**

```ts
// src/components/bl/blTimelinePresentation.ts
import type { BlTimelineEvent, BlTimelineFamily } from '../../services/blTimeline'

const FAMILY_LABEL: Record<BlTimelineFamily, string> = {
  edicao: 'Edição',
  container: 'Container',
  taxas: 'Taxas',
  fatura: 'Fatura',
  sistema: 'Sistema',
}

const FAMILY_TONE: Record<BlTimelineFamily, 'blue' | 'slate' | 'green' | 'yellow' | 'red'> = {
  edicao: 'blue',
  container: 'slate',
  taxas: 'green',
  fatura: 'yellow',
  sistema: 'red',
}

export function familyLabel(family: BlTimelineFamily): string {
  return FAMILY_LABEL[family]
}

export function familyTone(family: BlTimelineFamily) {
  return FAMILY_TONE[family]
}

export function describeTimelineEvent(event: BlTimelineEvent): string {
  const { entity_type, field_name, old_value, new_value } = event
  if (entity_type === 'invoice') {
    const verb = new_value === 'issued' ? 'emitida' : new_value === 'paid' ? 'paga' : `→ ${new_value ?? '-'}`
    return `Fatura ${verb}`
  }
  if (entity_type === 'charge_calculation' && field_name === 'manual_insert') {
    return `Other charge: ${new_value ?? '-'}`
  }
  if (entity_type === 'system_event') {
    return new_value ?? field_name
  }
  // edicao / container / charge_status genéricos
  return `${field_name}: ${old_value ?? '-'} → ${new_value ?? '-'}`
}

// Auditoria = entrada com justificativa (ver docs/GLOSSARIO.md).
export function isAudited(event: BlTimelineEvent): boolean {
  return Boolean(event.justification && event.justification.trim())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/bl/__tests__/blTimelinePresentation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/bl/blTimelinePresentation.ts src/components/bl/__tests__/blTimelinePresentation.test.ts
git commit -m "feat(bl): humanized timeline presentation map"
```

---

## Task 5: `BlHistoricoTab` and wire into `BlDetalhe`

**Files:**
- Create: `src/components/bl/BlHistoricoTab.tsx`
- Modify: `src/pages/BlDetalhe.tsx` (replace inline Histórico block; remove `useAuditLogs('bl', blId)` use)

- [ ] **Step 1: Implement the tab**

```tsx
// src/components/bl/BlHistoricoTab.tsx
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { formatDate } from '../../lib/utils'
import { useBlTimeline } from '../../hooks/useBlTimeline'
import { describeTimelineEvent, familyLabel, familyTone, isAudited } from './blTimelinePresentation'

export function BlHistoricoTab({ active, blId }: { active: boolean; blId?: string }) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useBlTimeline(blId)
  if (!active) return null
  const events = data?.pages.flat() ?? []
  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold text-white">Histórico</h2>
      <div className="grid gap-3">
        {events.length ? null : <div className="text-sm text-slate-400">Nenhum evento registrado ainda.</div>}
        {events.map((event) => (
          <div key={`${event.entity_type}-${event.id}`} className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-sm">
            <div className="mb-1 flex items-center gap-2">
              <Badge tone={familyTone(event.family)}>{familyLabel(event.family)}</Badge>
              {isAudited(event) ? <Badge tone="green">Auditoria</Badge> : null}
            </div>
            <div className="font-semibold text-white">{describeTimelineEvent(event)}</div>
            <div className="mt-1 text-slate-400">
              {formatDate(event.changed_at)} {event.justification ? `| ${event.justification}` : ''}
            </div>
          </div>
        ))}
      </div>
      {hasNextPage ? (
        <div className="mt-4">
          <Button type="button" variant="secondary" loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>
            Carregar mais
          </Button>
        </div>
      ) : null}
    </Card>
  )
}
```

- [ ] **Step 2: Replace the inline Histórico block in `BlDetalhe.tsx`**

- Remove the inline `activeTab === 'historico' ? (<Card>…audit_logs…</Card>) : null` block (BlDetalhe.tsx:168-185) and the `const { data: auditLogs } = useAuditLogs('bl', blId)` line (BlDetalhe.tsx:38).
- Render `<BlHistoricoTab active={activeTab === 'historico'} blId={blId} />` alongside the other tab components.
- Keep `useAuditLogs` exported (other callers may use it); just stop using it here. Confirm with a repo search that no other file relied on this page's usage.

- [ ] **Step 3: Build + tests**

Run: `npm run build`
Expected: PASS (no `auditLogs` references left on the page).
Run: `npx vitest run src/components/bl/__tests__/blTimelinePresentation.test.ts`
Expected: PASS.

- [ ] **Step 4: Manual verification**

Open a B/L with edits + at least one issued invoice. Confirm the Histórico tab shows mixed families with badges, an "Auditoria" badge on justified entries, newest-first, and that "Carregar mais" appears only when a full page returned.

- [ ] **Step 5: Commit**

```bash
git add src/components/bl/BlHistoricoTab.tsx src/pages/BlDetalhe.tsx
git commit -m "feat(bl): Historico timeline tab backed by bl_timeline RPC"
```

---

## Self-Review

**Spec coverage (Componente G):**
- RPC unioning the 4 join families + bl-scoped `system_event`, ordered, paginated, RLS-safe → Task 2. ✓
- Hook replacing `useAuditLogs('bl', …)` with pagination → Task 3, Task 5 Step 2. ✓
- Humanized presentation by family + audit marker → Task 4, Task 5. ✓
- Terminology "Histórico" heading (was "Auditoria") → Task 5 Step 1 (`<h2>Histórico</h2>`). ✓

**Placeholder scan:** The only deferred item is the `charge_status` keying, which Task 1 resolves with a concrete decision rule before Task 2 writes the WHERE — not a placeholder but a required discovery step (SQL schema reality).

**Type consistency:** `BlTimelineEvent`/`BlTimelineFamily` defined in `blTimeline.ts` and reused by the hook and presentation map. `queryKeys.bls.timeline` matches the hook. RPC param names (`p_bl_id`/`p_limit`/`p_offset`) match `fetchBlTimeline`.

**Protected file:** `src/types/database.ts` is guarded — Task 2 Step 3 keeps the row type local to `blTimeline.ts` to avoid editing it without authorization.

**Risk:** if Task 1 finds `charge_status` keyed by `bls.id`, add the `OR (entity_type='charge_status' AND entity_id = p_bl_id)` branch before applying the migration.
