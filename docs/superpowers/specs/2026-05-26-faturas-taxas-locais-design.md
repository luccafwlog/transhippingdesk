# Faturas de Taxas Locais — Redesign Visual e Geração de PIX

**Data:** 2026-05-26
**Escopo:** Reformular o documento de fatura de taxas locais (`InvoiceDocumentLocal`) para igualar visualmente o modelo de demurrage, suportar a apresentação de **faturas consolidadas** (múltiplos B/Ls do mesmo cliente em uma única invoice) e garantir que **todas as invoices de taxas locais** tenham `pix_payload` gerado e persistido.

---

## Contexto

Hoje o sistema já suporta a criação de invoices consolidadas — a RPC `create_invoice_from_bls` aceita um array de B/Ls e gera uma única invoice com todos os itens. O que está incompleto:

1. **Visual**: o `InvoiceDocumentLocal.tsx` atual é mais simples e tem um estilo diferente da fatura de demurrage. O cliente quer um padrão visual único.
2. **PIX**: a coluna `pix_payload` existe na tabela `invoices` desde a migration 001, mas a RPC `create_invoice_from_bls` nunca a preenche. O componente exibe o QR Code só se `pix_payload` for truthy — portanto, hoje, **nenhuma fatura de taxas locais tem QR Code de PIX**. O módulo de demurrage faz isso corretamente (`src/services/demurrage/demurrageInvoices.ts:179`).
3. **Consolidada**: o componente atual mostra os itens em uma tabela plana, sem indicar a qual B/L pertencem. Em faturas com vários B/Ls fica ambíguo.

Numeração das invoices está OK — o trigger `assign_invoice_number` (migration `003_functions.sql`) já gera `INV-YYYY-NNNN` automaticamente.

---

## Decisões de design

### Visual do documento

Estrutura espelhando `src/components/demurrage/InvoiceDocument.tsx`:

- **Header**: logo `transhipping-logo-cropped.png` (altura 52px) à esquerda, `Nº {invoice_number}` em azul `#1A2744` à direita.
- **Título centralizado**, uppercase, bold:
  - 1 B/L → `FATURA DE TAXAS LOCAIS`
  - 2+ B/Ls → `FATURA CONSOLIDADA DE TAXAS LOCAIS`
- **Separador horizontal**: `<hr>` 2px sólido `#111`.
- **Bloco de metadados** (tabela com label cell de 120px, font-weight 700):
  - `Cliente:` — nome + linha CNPJ formatado
  - `B/Ls:` — lista completa de `bl_id` separada por vírgula, em azul `#1A2744` font-weight 600
  - `Navio/Voy.:` — lista de navios+viagens distintos (ex: `GREEN SHANGHAI V2, OCEAN PIONEER V5`)
  - `Emissão:` — data formatada `dd/MM/yyyy`
  - (sem campo de vencimento)
- **Tabela de itens** (`font-size: 12px`, cabeçalho `background: #1A2744; color: white`):
  - Colunas: `Descrição | Qtd | Unit. BRL | Total BRL`
  - **B/L único** (1 B/L na invoice): linhas planas com zebra (`#f9fafb` vs branco).
  - **Consolidada** (2+ B/Ls): agrupada por B/L:
    - Linha header de grupo: `colspan=4`, `background: #e8edf5`, `color: #1A2744`, font-weight 700, texto `B/L {bl_id} — {pol} → {pod}`
    - Itens com `padding-left: 16px`, zebra mantida dentro do grupo
    - Linha de subtotal por B/L: `colspan=3 text-align: right` com `Subtotal {bl_id}:`, valor à direita, `background: #f0f4fa`, `border-bottom: 2px solid #c8d4e8`, `color: #1A2744`
  - Linha **TOTAL** final: `colspan=3 text-align: right`, `background: #F59E0B`, font-weight 700, valor `total_brl` à direita.
- **Sem seção de detalhes bancários** (remover bloco "DETALHES BANCÁRIOS" presente no componente atual).
- **Seção PIX** (apenas se `pix_payload` truthy — sempre será, após o fix):
  - QR Code (`QRCodeSVG` size 90) à esquerda
  - À direita: título `PAGAMENTO VIA PIX`, frase explicativa, `Valor da fatura: {total_brl}`, label `PIX COPIA E COLA` em uppercase, e o payload em monospace dentro de `<span>` com `background: #f3f4f6`, `font-size: 8px`, `word-break: break-all`.
- **Footer**: `Vitória, {data por extenso em pt-BR}` à direita, font-size 12px, `color: #555`.

### Geração e persistência do PIX

Espelhar o padrão do demurrage (`src/services/demurrage/demurrageInvoices.ts`):

1. **Para invoices novas** (criação): após `create_invoice_from_bls` ou `create_invoice_from_granite_bls` retornar com `invoice_id`, fazer no frontend (em `src/services/billing.ts`):
   - `SELECT invoice_number, total_brl FROM invoices WHERE id = :invoice_id`
   - `pix_payload = buildTransshippingPixPayload(total_brl, invoice_number)`
   - `UPDATE invoices SET pix_payload = :pix_payload WHERE id = :invoice_id`
   - Retornar o `invoice_id` normalmente; o consumer (`useCreateInvoice`) não muda.
2. **Para invoices existentes sem PIX** (backfill lazy): em `listInvoiceDetails` (`src/services/billing.ts:135`), após receber o payload da RPC, se `invoice.pix_payload` for null e a invoice estiver com status `issued`/`partially_paid`/`overdue`/`paid` e tiver `invoice_number` e `total_brl > 0`, gerar e persistir o payload da mesma forma antes de retornar.
3. O `txid` do PIX é o `invoice_number` (ex: `INV-2025-0042`). Isso garante reconciliação automática via a coluna `pix_txid` (migration 032).

### Numeração das invoices

Sem mudanças. O trigger `public.assign_invoice_number` no banco continua gerando `INV-YYYY-NNNN` com sequência por ano via `invoice_counters`.

---

## Arquivos afetados

| Arquivo | Mudança |
|---|---|
| `src/components/billing/InvoiceDocumentLocal.tsx` | Reescrita completa, espelhando `demurrage/InvoiceDocument.tsx` |
| `src/services/billing.ts` | Adicionar geração+persistência de `pix_payload` em `createInvoiceFromBls`, `createInvoiceFromGraniteBls`, e backfill em `listInvoiceDetails` |
| `src/components/billing/InvoiceDocumentLocal.tsx` (logo) | Trocar `/branding/tr-logo.png` por `/branding/transhipping-logo-cropped.png` |

Nenhuma migration de banco é necessária — colunas `pix_payload` e `pix_txid` já existem.

---

## Critérios de aceitação

1. Ao emitir uma invoice de taxas locais (única ou consolidada), o `pix_payload` é gerado e persistido na coluna `invoices.pix_payload`.
2. Ao abrir o detalhe de uma invoice antiga sem `pix_payload`, o sistema gera e salva o payload na primeira visualização.
3. O documento impresso (`InvoiceDocumentLocal`) exibe:
   - Logo `transhipping-logo-cropped.png` no header
   - Título correto baseado no número de B/Ls
   - Campo `Navio/Voy.` no bloco de metadados
   - Nenhuma referência a vencimento
   - Nenhuma seção de detalhes bancários
   - Itens agrupados por B/L com subtotal por grupo quando a invoice tem 2+ B/Ls
   - Seção PIX com QR Code + Copia e Cola
4. Para invoices com B/L único, os itens aparecem em tabela plana sem header de grupo nem subtotal.
5. O QR Code do PIX abre corretamente em apps bancários e contém o valor `total_brl` e txid `invoice_number`.

---

## Fora de escopo

- Mudanças em invoices de demurrage (já corretas).
- Mudanças no fluxo de criação no painel (`Faturamento.tsx`) — apenas o documento impresso e a persistência do PIX mudam.
- Reconciliação de pagamentos PIX via extrato bancário (já existe, apenas se beneficia da mudança).
- Numeração de invoices.
