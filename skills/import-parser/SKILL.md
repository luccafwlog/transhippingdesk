---
name: import-parser
description: Use when adding or changing CSV, XLSX, EDI, EDIFACT, fixed-width, carrier, manifesto, Baplie, vehicle, container, customer, CE Mercante, Granito, or Vazios import behavior in Transhipping Desk.
---

# Import Parser Playbook

Extend the closest proven parser. Preserve source authority, validate before
persisting, and protect each format with a faithful fixture.

## Before editing

State the format, entity, target tables/RPC, natural key, duplicate behavior,
atomicity requirement, and closest importer. Inspect a real sample and relevant
terms in `CONTEXT.md`.

| Shape | Reference |
|---|---|
| Header-mapped CSV/XLSX | `blParser.ts`, `blFreightImport.ts` |
| Breakbulk | `breakbulkImport.ts` |
| Carrier document (PDF/DOCX) | `blDocumentParser.ts`, `blDocumentPdf.ts`, `blDocumentDocx.ts` |
| EDI/EDIFACT | `baplieParser.ts`, `baplieImport.ts` |
| Focused upsert | `vehicleImport.ts`, `ceMercanteImport.ts` |
| Replaceable staging | `baplieImport.ts`, `containerDatesImport.ts` |
| Customer workbook | `customerBase.ts` |

Do not create a generic import framework for one format.

## Red-green

1. Add a real or faithful fixture.
2. Write valid-row and malformed-input tests.
3. Confirm the expected failure.
4. Implement the minimum parser/import change.
5. Run focused and related parser tests.

## File safety

Validate before reading:

```ts
import { assertUploadSize } from '../lib/fileGuard'

assertUploadSize(file)
const XLSX = await import('@e965/xlsx')
const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
```

Adjust the guard import path to the service location. Prefer dynamic spreadsheet
imports.

Document formats follow the same rule: `pdfjs-dist` is imported dynamically
(`pdfjs-dist/legacy/build/pdf.mjs`, so browser and vitest share one code path)
and `.docx` is opened with `readZipTextEntry` from `src/lib/zipEntry.ts` —
`DecompressionStream`, no zip dependency in the bundle.

A document without a labelled form (a scan with text boxes over it) has no
header row to match. Read it by content — unit, voyage number, tax id, address
— and keep document order as the only structural signal; never key a field to
an absolute coordinate.

### Leia a planilha pelo seam

Nunca chame `XLSX.read` num parser novo. Use `readSheet` e `matchHeaders` de
`src/services/importCore.ts`:

```ts
import { matchHeaders, readSheet, type HeaderSpec } from './importCore'

const SPEC: HeaderSpec<'container' | 'tipo'> = {
  aliases: { container: ['container', 'conteiner'], tipo: ['tipo', 'type'] },
  required: ['container', 'tipo'],
}

const { headers, rows } = await readSheet(buffer)
const { columnByField, missing } = matchHeaders(headers, SPEC)
if (missing.length) throw new Error(`Colunas obrigatorias ausentes: ${missing.join(', ')}.`)
```

`readSheet` devolve datas como texto por padrão. Se o formato precisar de
`Date` ou valor numérico cru, declare a decisão na chamada com
`{ dates: 'date' }` ou `{ values: 'cru' }`. Passar opções do `xlsx` por fora
recria a deriva que este seam existe para impedir.

## Parser contract

- no Supabase writes or React imports;
- named output types;
- normalize headers, whitespace, BOM and line endings;
- distinguish required, optional and invalid values;
- return row-level preview errors;
- never silently coerce unknown critical values;
- retain source values needed for audit.

## Persistence contract

Use the client from `src/services/supabase.ts`, normally:

```ts
import { supabase } from './supabase'
```

- return a typed summary;
- use RPC for atomic multi-table changes;
- upsert only when replacement is intended;
- use file hash when duplicate uploads matter;
- follow an existing batching pattern;
- never report success after a required write failed.

Use a React Query hook for reused mutation lifecycle. A page event may call a
focused import service directly when matching the existing module and not
duplicating remote state.

## UI contract

Show selected file, preview/errors, explicit confirmation, progress, imported
and rejected counts, and refreshed data.

Não reconstrua o trio `file` / `parsing` / `importing` numa página nova. Use
`FileImportModal` (`src/components/shared/FileImportModal.tsx`), que é dono da
máquina arquivo → preview → confirmação, do lote e dos erros por arquivo. O
contexto conhecido vai em `subtitle`; o passo que precisa ser resolvido antes
do arquivo vai em `prerequisite` com `ready`.

## Schema and verification

Use sequential numbered migrations (`NNN_short_name.sql`, next number after the
highest prefix) and the `supabase-migration` playbook. Regenerate types when the
app contract changes.

Verify:

- valid, malformed, empty and oversized fixtures;
- duplicate/idempotency behavior;
- persisted row count in a controlled environment;
- source-to-database spot checks;
- no orphaned staging rows after failure;
- documentation, lint, tests and build when applicable.

## Common mistakes

- using the obsolete `xlsx` package;
- checking size after reading;
- mixing parsing and persistence;
- letting Baplie overwrite commercial authority;
- partial multi-table imports without an RPC;
- testing only a synthetic happy path.
