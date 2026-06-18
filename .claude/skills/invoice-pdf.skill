---
name: invoice-pdf
description: Use when adding or changing printable local-charge or Demurrage invoice documents, browser print behavior, invoice layout, fiscal formatting, operational references, totals, or PIX QR rendering in Transhipping Desk.
---

# Printable Invoice Documents

Invoices are React documents printed by the browser. Reuse existing blocks and
prove print output instead of assuming browser pagination behavior.

## Current architecture

- local: `src/components/billing/InvoiceDocumentLocal.tsx`;
- Demurrage: `src/components/demurrage/InvoiceDocument.tsx`;
- shared JSX: `src/components/shared/InvoiceDocumentKit.tsx`;
- formatters: `src/components/shared/invoiceFormat.ts`;
- print CSS: `src/index.css`;
- action: `window.print()`;
- QR: `QRCodeSVG` from `qrcode.react`.

The user may save a PDF from the browser dialog. Add a dedicated
PDF-generation library only for an explicit requirement the print architecture
cannot meet.

## Before editing

Read both invoice implementations, shared JSX/formatters, print CSS, actual
detail types, and persisted fields. State the closest template. Do not infer
fiscal data from memory.

## Reuse

Use shared owners where applicable:

- `InvoiceDocHeader`;
- `InvoiceDocTitle`;
- `InvoiceClientBlock`;
- `InvoiceDocFooter`;
- `invoiceFormat.ts`.

Keep line-item and PIX blocks local when structurally different. Extract only
duplication touched by the change.

## Content

Preserve available:

1. logo and number;
2. title;
3. customer name/document;
4. B/L, navio, viagem and other operational references;
5. line items and totals;
6. due date/notes;
7. PIX QR and copy string when a persisted payload exists;
8. current footer.

Do not promise address, page counter, repeated header, or another block not
supported by real data and rendering.

## Formatting and print

- use project formatters;
- pt-BR currency, dates and masked documents;
- align numeric columns consistently;
- keep controls outside print or hide them;
- prevent backdrop/document repetition;
- avoid splitting totals/PIX only where CSS can prove it;
- preserve A4 portrait unless the existing variant differs;
- claim pagination behavior only after target-browser evidence.

## Red-green

1. Add a component test for required content or conditions.
2. Confirm the expected failure.
3. Implement minimum JSX/formatting.
4. Run focused and related billing tests.
5. Inspect real print output.

Test semantics, not every inline style.

## Visual verification

Check one-item and multi-page data, both invoice variants when shared code
changed, with/without persisted PIX, logo fallback, hidden controls, and
unclipped totals. For material layout changes, save from the browser and inspect
the PDF. Scan only a QA PIX payload.

## Avoid

- computing PIX inline or changing `src/lib/pix.ts` as a layout side effect;
- hardcoding company/customer data;
- introducing a second visual language;
- watermark/debug text;
- copying shared blocks back into each document;
- declaring print behavior verified from JSX alone.

## Completion

Focused and related tests pass; short and long print previews were inspected;
conditional PIX matches persisted data; lint/build pass; validation docs change
when the operator workflow changes.
