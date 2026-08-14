# CNPJ Alfanumérico Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every internal and Portal CNPJ flow accept, preserve, normalize, validate, compare, display, import, and authenticate 14-character numeric or alphanumeric CNPJs.

**Architecture:** Establish one shared canonical CNPJ contract in TypeScript and one equivalent database normalizer. Canonical values are uppercase, punctuation-free, exactly 14 characters; display uses the official `XX.XXX.XXX/XXXX-XX` mask. Update all current digit-stripping consumers and keep the existing `TEXT UNIQUE` storage contract.

**Tech Stack:** React/TypeScript, Vitest, Supabase PostgreSQL migrations, Supabase Edge Functions.

---

### Task 1: Shared CNPJ contract

**Files:** `src/lib/cnpj.ts`, `src/lib/__tests__/cnpj.test.ts`

- Add failing tests for uppercase normalization, punctuation removal, 14-position validation, numeric and alphanumeric module-11 check digits, and official display masking.
- Implement normalization, validation, display formatting, and a safe canonical comparison helper without using `\D` stripping.

### Task 2: Internal customer flows

**Files:** `src/pages/Clientes.tsx`, `src/components/customers/CreateCustomerModal.tsx`, `src/services/customers.ts`, `src/services/customerBase.ts`, review/import/search consumers and tests.

- Replace CNPJ/CPF wording and 11-digit branches with CNPJ-only validation.
- Normalize on every input change, including paste, and preserve alphanumeric characters.
- Normalize CSV/XLSX values, searches, review links, billing joins, reports, and copies through the shared contract.

### Task 3: Portal flows

**Files:** `src/pages/PortalLogin.tsx`, `src/hooks/usePortalAuth.tsx`, Portal recovery/activation surfaces, `supabase/functions/portal-login/index.ts`, related Edge Functions and tests.

- Normalize pasted and typed CNPJs to uppercase canonical values in the UI.
- Allow alphanumeric login/recovery/provisioning while retaining the same generic authentication errors and rate limits.
- Apply the same display mask in Portal-visible surfaces and emails.

### Task 4: Database contract

**Files:** `supabase/migrations/293_cnpj_alfanumerico.sql`, migration contract tests, generated types if required.

- Add controlled `public.normalize_cnpj(text)` and canonicalize existing customer/account values without changing identifier content.
- Synchronize `customers.cnpj_cpf` and `customer_portal_accounts.login_cnpj` using the shared rules.
- Replace current Portal RPC paths that strip non-digits with canonical normalization and retain security grants/search paths.

### Task 5: Verification and documentation

- Run focused red/green tests, then `npm run docs:check`, lint, full tests, typecheck/build where available, and `git diff --check`.
- Review the final diff for remaining CNPJ-specific `onlyDigits`/`\\D` uses and update living module documentation where behavior is described.
