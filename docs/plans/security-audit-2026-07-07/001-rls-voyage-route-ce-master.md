# Plan 001: Restrict `voyage_route_ce_master` RLS to active internal users

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/security-audit-2026-07-07/README.md`.
>
> **Drift check (run first)**: `git diff --stat a894c5d..HEAD -- supabase/migrations src/services/voyageRouteSchedules.ts src/services/__tests__/voyageRouteCeMasterMigration.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `a894c5d`, 2026-07-07

## Why this matters

Migration 167 created `voyage_route_ce_master` (Mercante CE Master per voyage
route — customs registry data) with RLS policies `USING (true)` /
`WITH CHECK (true)` for **all four operations** to the `authenticated` role.
In this project, external Portal customers also authenticate via Supabase Auth
and therefore hold `authenticated` — so any Portal customer (or a deactivated
internal user) can read, insert, update, and hard-delete CE Master records for
any voyage directly through PostgREST (`/rest/v1/voyage_route_ce_master`),
bypassing the guarded RPC `set_voyage_route_ce_master` and its audit-log trail.
This is the exact defect class the team already fixed once in migration 160
(same reasoning, documented in that file's header comment). Fixing it restores
the default-deny contract of ADR 0004/0011.

## Current state

- `supabase/migrations/167_voyage_route_ce_master.sql` — creates the table,
  the permissive policies, and the (correctly guarded) SECURITY DEFINER RPC.
  Lines 18–22 today:

  ```sql
  ALTER TABLE public.voyage_route_ce_master ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "read voyage_route_ce_master"   ON public.voyage_route_ce_master FOR SELECT TO authenticated USING (true);
  CREATE POLICY "insert voyage_route_ce_master" ON public.voyage_route_ce_master FOR INSERT TO authenticated WITH CHECK (true);
  CREATE POLICY "update voyage_route_ce_master" ON public.voyage_route_ce_master FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  CREATE POLICY "delete voyage_route_ce_master" ON public.voyage_route_ce_master FOR DELETE TO authenticated USING (true);
  ```

- The RPC in the same file (lines 24–58) already enforces
  `auth.uid() IS NOT NULL AND public.is_active_user() AND p_changed_by = auth.uid()`
  and writes to `audit_logs`. It is `SECURITY DEFINER` (runs as owner), so it is
  **unaffected by RLS** — tightening the table policies does not break it.

- Client access (both internal-app only, never Portal):
  - `src/services/voyageRouteSchedules.ts:398` — writes via
    `supabase.rpc('set_voyage_route_ce_master', …)`.
  - `src/services/voyageRouteSchedules.ts:413` — reads via
    `supabase.from('voyage_route_ce_master')`. Internal users are active
    (`user_profiles.active = true`), so a `is_active_user()` SELECT policy
    keeps this working.

- The corrective pattern to mirror — migration
  `160_demurrage_invoice_history_rls_active.sql` (drop permissive policy,
  recreate with `public.is_active_user()`) and the policy shape of
  `124_vessel_schedules.sql:48-71` (INSERT/UPDATE gated by
  `public.is_active_user()`, DELETE by `public.is_admin()`).

- Migration conventions (ADR 0016 + `.claude/skills/supabase-migration`):
  sequential three-digit numbering; the latest migration is
  `168_overdue_invoice_alerts_ptbr_entity.sql`, so the new file is
  `169_…`. Never edit existing migration files (they are protected). Each
  migration carries a header comment explaining context/scope/rollback in
  pt-BR — mirror the style of migration 160's header.

- Existing test for this table's migration:
  `src/services/__tests__/voyageRouteCeMasterMigration.test.ts` — reads the
  SQL file from disk and string-asserts on its contents. Extend this pattern.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm ci --legacy-peer-deps` | exit 0 |
| Tests | `npm test` | all pass |
| Lint | `npm run lint` | exit 0 |
| Docs check | `npm run docs:check` | exit 0 |
| Build | `npm run build` | exit 0 |

## Suggested executor toolkit

- Invoke the project skill `supabase-migration` (in `.claude/skills/`) before
  writing the migration — it encodes the repo's migration rules (default-deny
  REVOKEs, naming, header format).
- Read `docs/adr/0004-supabase-rls-rpc-fronteira-seguranca.md` and
  `docs/adr/0011-revogacao-anon-security-definer-default-deny.md` for the
  security model this change must stay consistent with.

## Scope

**In scope** (the only files you should modify/create):
- `supabase/migrations/169_voyage_route_ce_master_rls_active.sql` (create)
- `src/services/__tests__/voyageRouteCeMasterMigration.test.ts` (extend)
- `docs/RASTREABILIDADE.md` / `docs/CHANGELOG.md` only if `npm run docs:check`
  requires it (follow its error output).
- `docs/plans/security-audit-2026-07-07/README.md` (status row)

**Out of scope** (do NOT touch):
- `supabase/migrations/167_voyage_route_ce_master.sql` — existing migrations
  are immutable and protected by hooks. The fix is a NEW forward migration.
- `src/services/voyageRouteSchedules.ts` — no client change needed.
- The RPC `set_voyage_route_ce_master` — already correct.

## Git workflow

- Branch: use the branch the operator designates (or `advisor/001-rls-voyage-route-ce-master`).
- Commit message style (pt-BR, conventional prefix, matching `git log`):
  `fix(security): restringe RLS de voyage_route_ce_master a usuarios ativos`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Write migration `169_voyage_route_ce_master_rls_active.sql`

Create `supabase/migrations/169_voyage_route_ce_master_rls_active.sql` with a
pt-BR header comment (context: 167 criou policies `USING (true)`; clientes do
Portal também são `authenticated`; mesma classe corrigida na 160; escopo:
reescreve policies; rollback: não recriar `USING (true)` sem controle
equivalente), then:

```sql
ALTER TABLE public.voyage_route_ce_master ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read voyage_route_ce_master"   ON public.voyage_route_ce_master;
DROP POLICY IF EXISTS "insert voyage_route_ce_master" ON public.voyage_route_ce_master;
DROP POLICY IF EXISTS "update voyage_route_ce_master" ON public.voyage_route_ce_master;
DROP POLICY IF EXISTS "delete voyage_route_ce_master" ON public.voyage_route_ce_master;

CREATE POLICY voyage_route_ce_master_select_active
  ON public.voyage_route_ce_master FOR SELECT
  TO authenticated USING (public.is_active_user());

CREATE POLICY voyage_route_ce_master_insert_active
  ON public.voyage_route_ce_master FOR INSERT
  TO authenticated WITH CHECK (public.is_active_user());

CREATE POLICY voyage_route_ce_master_update_active
  ON public.voyage_route_ce_master FOR UPDATE
  TO authenticated USING (public.is_active_user())
  WITH CHECK (public.is_active_user());

CREATE POLICY voyage_route_ce_master_delete_admin
  ON public.voyage_route_ce_master FOR DELETE
  TO authenticated USING (public.is_admin());
```

**Verify**: `ls supabase/migrations/ | tail -2` → shows `168_…` then
`169_voyage_route_ce_master_rls_active.sql`.

### Step 2: Extend the migration test

In `src/services/__tests__/voyageRouteCeMasterMigration.test.ts`, add a second
`describe` (or new test cases) that reads
`supabase/migrations/169_voyage_route_ce_master_rls_active.sql` and asserts:

- it drops each of the four quoted 167 policy names (four
  `DROP POLICY IF EXISTS` assertions);
- it contains `USING (public.is_active_user())` for SELECT and UPDATE,
  `WITH CHECK (public.is_active_user())` for INSERT, and
  `USING (public.is_admin())` for DELETE;
- it does **not** contain `USING (true)` (regression guard).

Model the structure on the existing tests in the same file (they use
`fs.readFileSync` + `expect(sql).toContain(...)`).

**Verify**: `npm test -- voyageRouteCeMasterMigration` → all pass, including
the new assertions.

### Step 3: Full verification gates

**Verify**: `npm run lint` → exit 0. `npm test` → all pass.
`npm run docs:check` → exit 0 (if it fails naming a doc that must list the new
migration, update only that doc per its error message and re-run).
`npm run build` → exit 0.

## Test plan

- New assertions in `src/services/__tests__/voyageRouteCeMasterMigration.test.ts`
  (see Step 2): policy drop coverage, `is_active_user()` / `is_admin()`
  scoping, and the `USING (true)` regression guard.
- Verification: `npm test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `supabase/migrations/169_voyage_route_ce_master_rls_active.sql` exists and `grep -c "USING (true)" supabase/migrations/169_voyage_route_ce_master_rls_active.sql` returns 0 matches (exit 1)
- [ ] `npm test` exits 0; new migration assertions pass
- [ ] `npm run lint`, `npm run docs:check`, `npm run build` all exit 0
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `docs/plans/security-audit-2026-07-07/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Migration 167's policy names or the `USING (true)` clauses do not match the
  excerpt above (drifted — someone may have already fixed this).
- A migration numbered `169_` already exists — renumber to the next free
  number and note it, but STOP first if that number is also referenced by
  other pending plans.
- You find a Portal-facing code path that reads `voyage_route_ce_master`
  (search: `grep -rn "voyage_route_ce_master" src/`) beyond
  `src/services/voyageRouteSchedules.ts` — the scoping assumption would be
  wrong.
- Any hook blocks your edit citing a protected file — do not bypass it.

## Maintenance notes

- Applying this migration to production is a separate operational step (the
  SPA CI does not apply migrations — see `WORKFLOW.md`). The code change is
  safe to merge before the migration is applied because the internal app's
  read/write paths already satisfy the tighter policies.
- Reviewer should scrutinize: policy names dropped exactly as quoted in 167
  (they contain spaces and need double quotes), and that no `GRANT` on the
  table was widened.
- Future tables must not repeat this: per ADR 0004/0011, new tables get
  `is_active_user()` / `is_admin()` policies (or portal scoping) from the
  start. Consider a follow-up lint/test that greps new migrations for
  `USING (true)` on `TO authenticated` policies (deferred — not in this plan).
