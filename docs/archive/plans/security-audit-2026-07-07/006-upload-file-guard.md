# Plan 006: Extend the upload guard with a file-type allowlist

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/security-audit-2026-07-07/README.md`.
>
> **Drift check (run first)**: `git diff --stat a894c5d..HEAD -- src/lib/fileGuard.ts src/lib/__tests__`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: none
- **Category**: security (defense-in-depth; internal-only surface)
- **Planned at**: commit `a894c5d`, 2026-07-07

## Why this matters

All 16 import parsers (XLSX/CSV/EDI) guard uploads with `assertUploadSize`
only — a 10 MB byte cap with no extension/type validation. A 10 MB XLSX is a
ZIP container that can decompress to far more, and a mispicked file (or a
crafted one) goes straight into `XLSX.read`. The blast radius is limited —
importers are internal-app only, so this is chiefly a self-DoS of the
uploader's own tab plus a robustness gap — which is why this is P3. The fix
is a small, central extension of the existing guard: validate the extension
against each importer's expected set before parsing.

## Current state

- `src/lib/fileGuard.ts` — the entire guard today:

  ```ts
  // Limite padrão para uploads de planilhas (10 MB).
  // Acima disso o parser do XLSX consome memória rápido demais e pode
  // derrubar a aba do navegador — usado como salvaguarda contra DoS.
  const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

  export function assertUploadSize(file: File, maxBytes: number = MAX_UPLOAD_BYTES) {
    if (file.size > maxBytes) {
      const limitMb = (maxBytes / 1_048_576).toFixed(0)
      throw new Error(
        `Arquivo muito grande (${(file.size / 1_048_576).toFixed(1)} MB). O limite é ${limitMb} MB.`,
      )
    }
  }
  ```

- 16 caller files (list them yourself:
  `grep -rln "assertUploadSize" src --include='*.ts'`), e.g.
  `src/services/blParser.ts`, `src/services/manifestParser.ts`,
  `src/services/ceMercanteEdiParser.ts`, `src/services/baplieParser.ts`,
  `src/services/demurrage/demurrageKpis.ts`. Each knows which formats it
  accepts (XLSX/XLS/CSV vs. EDI/TXT) — read each call site to pick the right
  set; the file-picker `accept=` attribute in the corresponding page/component
  is a good cross-check.
- Existing tests for lib helpers: `src/lib/__tests__/*.test.ts` (Vitest).
  There is no `fileGuard.test.ts` yet.
- Error messages are user-facing pt-BR with accents in this file — match its
  existing style.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm ci --legacy-peer-deps` | exit 0 |
| Focused test | `npm test -- fileGuard` | all pass |
| Tests | `npm test` | all pass |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build` | exit 0 |

## Scope

**In scope** (the only files you should modify/create):
- `src/lib/fileGuard.ts`
- `src/lib/__tests__/fileGuard.test.ts` (create)
- The 16 caller files — ONLY the line(s) invoking the guard (switch to the
  new function with the right extension set). No other changes in them.
- `docs/plans/security-audit-2026-07-07/README.md` (status row)

**Out of scope** (do NOT touch):
- Parser logic, import mapping, or UI components/file pickers.
- A decompressed-size/row-count cap inside `XLSX.read` — deferred (see
  Maintenance notes) to keep this diff surgical.
- `src/lib/pix.ts` and other protected files.

## Git workflow

- Branch: use the branch the operator designates (or `advisor/006-upload-file-guard`).
- Commit message style: `fix(security): valida extensao de arquivo no guard de upload`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add `assertUploadFile` to the guard

In `src/lib/fileGuard.ts`, add (keeping `assertUploadSize` exported and
unchanged for compatibility):

```ts
export function assertUploadFile(
  file: File,
  allowedExtensions: readonly string[],
  maxBytes: number = MAX_UPLOAD_BYTES,
): void
```

Behavior: run the existing size check, then compare the file's extension
(lowercased text after the final `.` in `file.name`) against
`allowedExtensions` (store sets lowercased, without dots, e.g.
`['xlsx', 'xls', 'csv']`). On mismatch throw a pt-BR error naming the
expected formats, e.g.
`Formato de arquivo não suportado (.pdf). Formatos aceitos: .xlsx, .xls, .csv.`
A file with no extension fails the check. Do not trust `file.type` (browsers
report it inconsistently for XLSX) — extension is the contract here.

**Verify**: `npm run lint` → exit 0.

### Step 2: Switch the 16 callers

For each file from `grep -rln "assertUploadSize" src --include='*.ts'`
(excluding `fileGuard.ts` itself and any test), replace the call with
`assertUploadFile(file, [...])` using the extension set that importer really
accepts (determine per call site; typical sets: spreadsheets
`['xlsx','xls','csv']`, EDI/text `['edi','txt']`, Baplie may include no-dot
conventions — if an importer legitimately accepts extension-less files, keep
`assertUploadSize` there and note it in your report instead of guessing).
Update imports accordingly.

**Verify**: `grep -rn "assertUploadSize(" src --include='*.ts' | grep -v fileGuard | grep -v __tests__` → only the call sites you consciously left (report each), ideally 0.

### Step 3: Tests

Create `src/lib/__tests__/fileGuard.test.ts` (model on
`src/lib/__tests__/csv.test.ts` structure; construct `File` objects via
`new File([new Uint8Array(n)], 'name.ext')`):

1. accepts an allowed extension under the size cap
2. rejects an oversized file (message contains the MB limit)
3. rejects a disallowed extension (message names accepted formats)
4. extension matching is case-insensitive (`REPORT.XLSX` passes)
5. file without extension is rejected
6. `assertUploadSize` still behaves as before (compat)

**Verify**: `npm test -- fileGuard` → all 6 pass.

## Test plan

See Step 3. Full-suite: `npm test` → all pass (existing importer tests prove
the call-site switch didn't break parsing).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `src/lib/__tests__/fileGuard.test.ts` exists with the 6 cases; `npm test -- fileGuard` passes
- [ ] Step 2 grep shows no unexplained `assertUploadSize` call sites
- [ ] `npm run lint`, `npm test`, `npm run build` all exit 0
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `docs/plans/security-audit-2026-07-07/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- A caller's accepted formats are ambiguous after reading its call site AND
  its file-picker `accept=` attribute — list the ambiguous importers instead
  of guessing extension sets.
- Any importer test starts failing after the switch — the extension set is
  wrong for that importer; report rather than widening the set blindly.
- The hook system blocks an edit citing a protected file.

## Maintenance notes

- Extension checks are a robustness/UX guard, not a security boundary — a
  renamed malicious file passes. The real ceiling here (deferred): a
  decompressed row/cell-count cap after `XLSX.read` before mapping, which
  bounds memory regardless of file honesty. Revisit if imports ever become
  portal-facing.
- New importers must call `assertUploadFile` with their format set — reviewers
  should reject new `XLSX.read` call sites without it.
