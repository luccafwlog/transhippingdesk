---
name: supabase-migration
description: Use when creating or reviewing a Transhipping Desk Supabase migration involving tables, columns, indexes, constraints, foreign keys, RLS, grants, views, functions, triggers, RPCs, enums, or generated database types.
---

# Supabase Migration Playbook

Inspect the real schema, default to least privilege, and prove migrations in a
disposable database branch.

## Before editing

State:

- business intent;
- affected tables/functions;
- breaking or additive;
- app and Portal consumers;
- rollback/recovery.

Inspect affected tables, advisors, relevant ADRs, and recent migrations. Never
invent types, constraints, policies, or grants from memory.

## File and scope

- create `supabase/migrations/YYYYMMDDHHMMSS_short_name.sql`;
- PowerShell timestamp: `Get-Date -AsUTC -Format 'yyyyMMddHHmmss'`;
- one logical change per file;
- never edit or rename an applied migration;
- split heavy backfill into a reviewed script under `supabase/scripts/`.

## SQL conventions

- declare every foreign-key `ON DELETE` behavior;
- index new FKs and demonstrated hot filters/orderings;
- use `timestamptz default now() not null` for creation time;
- add `updated_at` only with its maintenance trigger;
- prefer UUID/identity according to neighboring tables;
- prefer text plus check constraint for values expected to evolve;
- include a rollback comment.

Do not add speculative indexes or abstractions.

## RLS and grants

Every new client-visible table needs RLS and policies matching the nearest
domain table. A server-only table needs explicit revokes and a comment
explaining why it has no client policy.

For every function, especially `SECURITY DEFINER`:

- set controlled `search_path`;
- revoke `PUBLIC` and `anon` in the same migration;
- revoke direct `authenticated` execution for trigger functions;
- grant only roles that call the function;
- validate `auth.uid()` or role inside privileged RPCs.

The documented exception is `portal_resolve_login(text)` (ADR 0013). Any new
pre-authentication `anon` grant requires a business reason, generic
non-enumerating errors, abuse controls, a focused migration test, and an ADR or
ADR update. Never copy this exception to ordinary Portal data RPCs.

## App coupling

Before dropping/renaming, search `src/services/`, `src/hooks/`, pages, Edge
Functions, tests and docs. Regenerate `src/types/database.ts` when the app
contract changes; never hand-edit generated rows to hide drift.

Coordinate migration application before dependent frontend deployment. The SPA
CI does not apply migrations.

## Red-green

1. Add a focused migration-contract or integration test.
2. Confirm failure before the migration exists.
3. Write the minimum SQL.
4. Run focused tests.
5. Apply to a disposable database branch.
6. verify behavior, RLS, grants and advisors.

## Verification

- migration history shows the expected version;
- table/function shape matches the contract;
- authorized calls succeed; unauthorized calls fail;
- security advisors have no new finding;
- performance review shows no missing index introduced by this change;
- generated types and app build align;
- lint/tests/build pass;
- living docs update when contracts change.

## Never

- test destructive SQL on production;
- run the suspended reset script;
- weaken RLS to fix a frontend error;
- expose a privileged function to `anon` without the exception process;
- combine unrelated schema cleanup;
- report success from a regex-only test.
