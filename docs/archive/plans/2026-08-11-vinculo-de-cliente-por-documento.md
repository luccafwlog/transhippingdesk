# Vínculo de Cliente Somente por Documento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o código cumprir a regra de domínio registrada em
[`docs/archive/audits/2026-08-11-vinculo-de-cliente-por-nome.md`](../archive/audits/2026-08-11-vinculo-de-cliente-por-nome.md):
o Cliente só é vinculado a um B/L por **documento exato** (CNPJ ou CPF, ambos em
`customers.cnpj_cpf`). Match por nome vira **sugestão** — nunca vínculo — em
container/carga solta e em granito.

**Architecture:** A correção acontece no ponto compartilhado, não em cada call
site. `findMatchedCustomer` continua produzindo os quatro níveis (o nível por
nome é útil como sugestão), mas passa a ser consumido por um único tradutor
`resolveCustomerLink`, que devolve `customerId` (só com `matchType: 'document'`),
`suggestedCustomerId` e o status de reconciliação. Os quatro call sites passam a
usar esse tradutor. A sugestão ganha coluna própria em `bls` e `granite_bls`, de
modo que nenhuma tela perde a informação que hoje é obtida gravando o vínculo
errado.

**Tech Stack:** TypeScript (services e páginas), Supabase/PostgreSQL
(migrations `280`+), Vitest (testes de comportamento e testes de contrato SQL).

## Contexto verificado (baseline)

Estado do código na data deste plano — todas as linhas conferidas na árvore:

| Fato | Onde |
|---|---|
| `findMatchedCustomer` devolve `matchType: 'name'` nos níveis 2–4 | `src/services/customerReconciliation.ts:105` |
| Import de B/L grava `customer_id` sem olhar `matchType` | `src/services/blFreightImport.ts:462` |
| Import de carga solta grava `customer_id` idem | `src/services/breakbulkImport.ts:68` |
| Import de granito colapsa qualquer match em `'matched'` (dentro da guarda `if (cnpjDigits)`) | `src/services/graniteImport.ts:119-129` |
| Override manual de CNPJ no granito repete o colapso | `src/pages/Granite.tsx:96` |
| Pendência canônica `Cliente nao vinculado` testa `p_customer_id IS NULL` | `supabase/migrations/188_review_gate_remove_portal.sql:21` |
| A nota `Cliente vinculado por nome; validar CNPJ` é escrita hoje pelo RPC de import | `supabase/migrations/205_bl_document_fields.sql:676-685` |
| `save_bl_review` recomputa o status só pelos motivos canônicos e apaga a linha `Pendencias de importacao:` | `supabase/migrations/205_bl_document_fields.sql:827+` |
| Gate de faturamento exige `matched_document`/`reconciled` — está correto e não muda | `supabase/migrations/275_ready_gate_without_table_validity.sql:65` |
| A fila de reconciliação nasce `pending` para `matched_name`, e a sugestão vem hoje de `bls.customer_id` | `supabase/migrations/025_billing_orchestration_portal.sql:509` |
| `approve_customer_reconciliation` é o caminho humano legítimo: grava `customer_id` e `reconciled` | `supabase/migrations/025_billing_orchestration_portal.sql:1570` |
| Carga solta **não** passa pelo RPC de frete: `import_breakbulk_manifest_transactional` delega ao `import_manifest_transactional`, que enumera as colunas de `bls` uma a uma | `supabase/migrations/144_import_breakbulk_manifest_transactional.sql:20`, `supabase/migrations/165_manifest_overwrite_opt_in.sql:85-157` |
| Fila de revisão do granito filtra `.is('client_id', null)` — é ela que faz um granito casado por nome sumir | `src/hooks/useReview.ts:66` |
| Faturamento de granito exige apenas `client_id IS NOT NULL` | `supabase/migrations/039_granite_invoiceable_view.sql:100` |
| `granite_bls` **não** tem coluna de status de reconciliação nem `manifest_customer_*` | `src/types/database.ts:2168+` |
| `save_granite_bl_review` deixa o operador escolher **qualquer** cliente e registra a decisão em `audit_logs` | `supabase/migrations/148_save_granite_bl_review_atomic.sql:33-44` |
| Embeds PostgREST hoje dependem de haver uma única FK para `customers`; só `chargeOperationsService.ts:421` já qualifica (`!granite_bls_client_id_fkey`) | `src/hooks/useBls.ts:14,231`, `src/hooks/useReview.ts:51,63,86`, `src/services/graniteCharges.ts:114`, `src/services/reports.ts:63,230,355`, `src/services/charges/chargeOperationsService.ts:651` |

Consequência para o plano: a sugestão por nome **não pode** ser parqueada em
`manifest_customer_name` / `manifest_customer_cnpj_cpf` (a "Correção necessária"
do audit sugere isso). Esses campos guardam o texto do manifesto, não um id de
cliente, e não existem em `granite_bls`. Cada tabela precisa de uma coluna de
sugestão própria.

## Decisões desta correção

1. **Vínculo:** `bls.customer_id` e `granite_bls.client_id` só recebem valor com
   `matchType === 'document'` ou por decisão humana registrada
   (`approve_customer_reconciliation`, `save_granite_bl_review`).
2. **Sugestão:** nova coluna `suggested_customer_id` em `bls` e
   `suggested_client_id` em `granite_bls`. A sugestão nunca fatura, nunca
   satisfaz pendência e nunca entra em view de faturamento.
3. **Fila de reconciliação de B/L:** `sync_customer_reconciliation_queue_for_bl`
   passa a alimentar `customer_reconciliation_queue.customer_id` com
   `COALESCE(customer_id, suggested_customer_id)`, preservando o um-clique de
   aprovação que hoje depende do vínculo indevido.
4. **Status:** `customer_reconciliation_status = 'matched_name'` continua
   existindo e passa a significar exatamente "há sugestão, não há vínculo".
   `ReconciliationStatus` do granito ganha o estado equivalente.
5. **Nota textual:** `Cliente vinculado por nome; validar CNPJ` perde objeto — o
   motivo canônico `Cliente nao vinculado` volta a cobrir o caso e sobrevive ao
   save. O bloco que injeta a nota sai do RPC.
6. **Backfill:** linhas já gravadas sob a regra antiga são migradas
   (`customer_id` → `suggested_customer_id`), exceto as que já foram decididas
   por humano (`reconciled` em `bls`; entrada em `audit_logs` no granito) ou já
   faturadas.
7. **Segunda FK para `customers`:** cada coluna de sugestão cria uma segunda
   chave estrangeira na mesma tabela, o que torna **ambíguo** todo embed
   PostgREST não qualificado (`customer:customers(...)`) enraizado em `bls` ou
   `granite_bls`. As FKs são nomeadas explicitamente
   (`bls_suggested_customer_id_fkey`, `granite_bls_suggested_client_id_fkey`) e
   os embeds existentes passam a qualificar o vínculo
   (`customer:customers!bls_customer_id_fkey(...)`,
   `customer:customers!granite_bls_client_id_fkey(...)`) **no mesmo change da
   migration** — senão as telas quebram entre um deploy e outro.

## Global Constraints

- Não alterar `src/types/database.ts` à mão: regerar após as migrations
  (`WORKFLOW.md`); o arquivo é protegido por `.claude/hooks/protect-files.sh`.
- Não editar migrations existentes: toda mudança de RPC/função entra como
  `CREATE OR REPLACE` em migration nova (numeração a partir de `280`).
- Não afrouxar o gate de faturamento: `mark_bl_ready_for_billing` e
  `isCustomerReconciliationResolved` ficam como estão.
- O backfill não pode tocar B/L com `financial_status = 'invoiced'`, com
  `customer_reconciliation_status = 'reconciled'`, nem granito com decisão
  humana em `audit_logs` ou já faturado.
- Cada task deixa uma verificação executável (teste Vitest ou teste de contrato
  SQL), conforme `CLAUDE.md`.

---

### Task 1: Tradutor único de match para vínculo

**Files:**
- Modify: `src/services/customerReconciliation.ts`
- Test: `src/services/__tests__/customerReconciliation.test.ts`

**Interfaces:**
- `export type CustomerLink = { customerId: number | null; suggestedCustomerId: number | null; status: 'matched_document' | 'matched_name' | 'missing_customer'; notes: string }`
- `export function resolveCustomerLink(match: CustomerMatchResult | null): CustomerLink`

- [ ] **Step 1: Write the failing test** cobrindo os três casos: match `document`
      → `customerId` preenchido e `suggestedCustomerId` nulo; match `name` →
      `customerId` **nulo** e `suggestedCustomerId` preenchido; `null` →
      ambos nulos com `missing_customer`.
- [ ] **Step 2: Run test to verify it fails** com `npx vitest run src/services/__tests__/customerReconciliation.test.ts`.
- [ ] **Step 3: Write minimal implementation** de `resolveCustomerLink`,
      centralizando também os textos de `customer_reconciliation_notes` hoje
      duplicados em `blFreightImport.ts:454-470` e `breakbulkImport.ts:60-108`.
- [ ] **Step 4: Run test to verify it passes** com o mesmo comando.
- [ ] **Step 5: Commit** com `git add src/services/customerReconciliation.ts src/services/__tests__/customerReconciliation.test.ts && git commit -m "feat(reconciliacao): traduzir match em vinculo somente por documento"`.

### Task 2: Migration de sugestão e fila para `bls`

**Files:**
- Create: `supabase/migrations/280_customer_link_requires_document.sql`
- Test: `src/services/__tests__/customerLinkRequiresDocumentMigration.test.ts`

**Interfaces:**
- `ALTER TABLE public.bls ADD COLUMN IF NOT EXISTS suggested_customer_id BIGINT` + `ADD CONSTRAINT bls_suggested_customer_id_fkey FOREIGN KEY (suggested_customer_id) REFERENCES public.customers(id) ON DELETE SET NULL` (nome explícito — é ele que os embeds vão precisar desambiguar).
- `CREATE OR REPLACE FUNCTION public.sync_customer_reconciliation_queue_for_bl` — mesma assinatura, usando `COALESCE(b.customer_id, b.suggested_customer_id)` na coluna `customer_id` da fila e mantendo `detection_type = 'name'` para `matched_name`.
- `CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional` — cópia de `205_bl_document_fields.sql` **sem** o bloco `UPDATE ... 'Cliente vinculado por nome; validar CNPJ'` (linhas 674-686) e persistindo `suggested_customer_id` a partir do payload.
- `CREATE OR REPLACE FUNCTION public.approve_customer_reconciliation` — ao aprovar, zerar `bls.suggested_customer_id`.

- [ ] **Step 1: Write the failing test** (teste de contrato SQL, no padrão de
      `src/services/__tests__/readyGateWithoutTableValidityMigration.test.ts`):
      o arquivo `280` declara a coluna **e a constraint nomeada**, a fila usa
      `COALESCE`, o texto `Cliente vinculado por nome` não aparece mais no RPC
      de import, e o gate `matched_document`/`reconciled` continua intacto.
- [ ] **Step 2: Run test to verify it fails** com `npx vitest run src/services/__tests__/customerLinkRequiresDocumentMigration.test.ts`.
- [ ] **Step 3: Write minimal implementation** da migration, seguindo
      `skills/supabase-migration/SKILL.md` (grants, `search_path`, `SECURITY`
      preservados de cada função copiada).
- [ ] **Step 4: Run test to verify it passes** com o mesmo comando.
- [ ] **Step 5: Regenerate types** conforme `WORKFLOW.md` e confirmar
      `suggested_customer_id` em `src/types/database.ts`.
- [ ] **Step 6: Commit** com `git add supabase/migrations/280_customer_link_requires_document.sql src/services/__tests__/customerLinkRequiresDocumentMigration.test.ts src/types/database.ts && git commit -m "feat(db): separar sugestao de cliente do vinculo em bls"`.

### Task 3: Persistir a sugestão também no RPC genérico de manifesto

Sem esta task, a sugestão de carga solta é descartada em silêncio:
`import_breakbulk_manifest_transactional` delega ao `import_manifest_transactional`
(`165_manifest_overwrite_opt_in.sql:85-157`), que enumera as colunas de `bls`
explicitamente — uma coluna nova só existe para o RPC se for adicionada ali.

**Files:**
- Create: `supabase/migrations/281_manifest_import_customer_suggestion.sql`
- Test: `src/services/__tests__/manifestImportCustomerSuggestionMigration.test.ts`

**Interfaces:**
- `CREATE OR REPLACE FUNCTION public.import_manifest_transactional(...)` — mesma assinatura de `165`, acrescentando `suggested_customer_id` ao `INSERT`, ao `SELECT` (`NULLIF(bl->>'suggested_customer_id', '')::BIGINT`) e ao `ON CONFLICT DO UPDATE SET`.
- Atenção ao `COALESCE` do status (`165:124-130`): ele infere `'reconciled'` quando há `customer_id`. Como o payload passa a mandar o status explícito, o comportamento não muda — mas o teste precisa fixar isso.

- [ ] **Step 1: Write the failing test** (contrato SQL): o RPC genérico enumera
      `suggested_customer_id` nas três posições, e a inferência de status
      continua idêntica quando o payload não manda status.
- [ ] **Step 2: Run test to verify it fails** com `npx vitest run src/services/__tests__/manifestImportCustomerSuggestionMigration.test.ts`.
- [ ] **Step 3: Write minimal implementation** copiando a função de `165` com as
      três adições, preservando `p_apply_overwrites`, grants e `search_path`.
- [ ] **Step 4: Run test to verify it passes** com o mesmo comando.
- [ ] **Step 5: Commit** com `git add supabase/migrations/281_manifest_import_customer_suggestion.sql src/services/__tests__/manifestImportCustomerSuggestionMigration.test.ts && git commit -m "feat(db): persistir sugestao de cliente no import de manifesto"`.

### Task 4: Imports de container e carga solta usando o tradutor

**Files:**
- Modify: `src/services/blFreightImport.ts`
- Modify: `src/services/breakbulkImport.ts`
- Test: `src/services/__tests__/blFreightImport.test.ts`
- Test: `src/services/__tests__/breakbulkImport.test.ts`

**Interfaces:**
- `applyCustomerReconciliation` passa a delegar a `resolveCustomerLink` e a
  gravar `payload.suggested_customer_id`.
- `breakbulkImport` para de sobrescrever `consignee` com o nome do cliente
  quando o match veio por nome (`breakbulkImport.ts:96`), e deixa de emitir o
  motivo `Cliente vinculado por nome; validar CNPJ`.

- [ ] **Step 1: Write the failing test** com um cadastro cujo nome casa e cujo
      CNPJ não: o payload resultante deve ter `customer_id: null`,
      `suggested_customer_id` preenchido, `customer_reconciliation_status:
      'matched_name'` e `billing_hold_reason` preservado.
- [ ] **Step 2: Run test to verify it fails** com `npx vitest run src/services/__tests__/blFreightImport.test.ts src/services/__tests__/breakbulkImport.test.ts`.
- [ ] **Step 3: Write minimal implementation** nos dois serviços, sem duplicar
      regra: toda decisão vem de `resolveCustomerLink`.
- [ ] **Step 4: Run test to verify it passes** com o mesmo comando.
- [ ] **Step 5: Commit** com `git add src/services/blFreightImport.ts src/services/breakbulkImport.ts src/services/__tests__ && git commit -m "fix(import): nao vincular cliente por nome em container e carga solta"`.

### Task 5: Desambiguar os embeds enraizados em `bls`

Consequência direta da segunda FK (decisão 7). Vai no mesmo lote das migrations
`280`/`281`.

**Files:**
- Modify: `src/hooks/useBls.ts` (linhas 14 e 231)
- Modify: `src/hooks/useReview.ts` (linha 51)
- Modify: `src/services/reports.ts` (linhas 63, 230, 355)
- Modify: `src/services/charges/chargeOperationsService.ts` (linha 651)
- Test: `src/services/__tests__/customerEmbedDisambiguation.test.ts`

**Interfaces:**
- Todo embed enraizado em `bls` passa a `customer:customers!bls_customer_id_fkey(...)`.
- Embeds enraizados em `invoices`, `demurrage_*` e demais tabelas **não** mudam:
  a ambiguidade é só de quem tem duas FKs para `customers`.

- [ ] **Step 1: Write the failing test** — varredura estática que falha se
      alguma string de select enraizada em `bls`/`granite_bls` contiver
      `customer:customers(` sem `!`.
- [ ] **Step 2: Run test to verify it fails** com `npx vitest run src/services/__tests__/customerEmbedDisambiguation.test.ts`.
- [ ] **Step 3: Write minimal implementation** qualificando os embeds listados.
- [ ] **Step 4: Run test to verify it passes** e rodar a suíte dos consumidores
      afetados (`npx vitest run src/hooks src/services/__tests__/exports.test.ts`).
- [ ] **Step 5: Commit** com `git add src/hooks src/services && git commit -m "fix(query): qualificar embed de cliente apos segunda fk em bls"`.

### Task 6: Granito — coluna de sugestão e RPCs

**Files:**
- Create: `supabase/migrations/282_granite_customer_link_requires_document.sql`
- Test: `src/services/__tests__/graniteCustomerLinkMigration.test.ts`

**Interfaces:**
- `ALTER TABLE public.granite_bls ADD COLUMN IF NOT EXISTS suggested_client_id BIGINT` + `ADD CONSTRAINT granite_bls_suggested_client_id_fkey FOREIGN KEY (suggested_client_id) REFERENCES public.customers(id) ON DELETE SET NULL`.
- `CREATE OR REPLACE FUNCTION public.import_granite_manifest_transactional` — cópia de `136_import_granite_manifest_transactional.sql` aceitando `suggested_client_id` no payload de cada B/L.
- `CREATE OR REPLACE FUNCTION public.save_granite_bl_review` — ao gravar `client_id`, zerar `suggested_client_id` (a decisão humana consome a sugestão).

- [ ] **Step 1: Write the failing test** (contrato SQL): coluna e constraint
      nomeada declaradas, RPC de import lendo `suggested_client_id`,
      `save_granite_bl_review` limpando a sugestão, e
      `039_granite_invoiceable_view.sql` **não** referenciando a sugestão
      (faturamento segue só por `client_id`).
- [ ] **Step 2: Run test to verify it fails** com `npx vitest run src/services/__tests__/graniteCustomerLinkMigration.test.ts`.
- [ ] **Step 3: Write minimal implementation** das migrations de função,
      preservando grants e guardas de `is_active_user()`.
- [ ] **Step 4: Run test to verify it passes** com o mesmo comando.
- [ ] **Step 5: Regenerate types** e confirmar `suggested_client_id`.
- [ ] **Step 6: Commit** com `git add supabase/migrations/282_granite_customer_link_requires_document.sql src/services/__tests__/graniteCustomerLinkMigration.test.ts src/types/database.ts && git commit -m "feat(db): separar sugestao de cliente do vinculo em granite_bls"`.

### Task 7: Granito — parser, override manual, badge e embeds

**Files:**
- Modify: `src/services/graniteImport.ts`
- Modify: `src/pages/Granite.tsx`
- Modify: `src/services/graniteCharges.ts` (linha 114)
- Modify: `src/hooks/useReview.ts` (linhas 63 e 86)
- Test: `src/services/__tests__/graniteImport.test.ts`
- Test: `src/pages/__tests__/Granite.behavior.test.tsx`

**Interfaces:**
- `export type ReconciliationStatus = 'matched' | 'suggested_name' | 'missing_cnpj' | 'not_found'`.
- `GraniteBlDraft` ganha `suggestedClientId: number | null`.
- `handleCnpjOverride` (`Granite.tsx:87`) só promove a `matched` com
  `matchType === 'document'`; com match por nome, marca `suggested_name`.
- Embeds de `granite_bls` passam a `customer:customers!granite_bls_client_id_fkey(...)`
  (padrão que `chargeOperationsService.ts:421` já usa) e, onde a sugestão for
  exibida, `suggested_customer:customers!granite_bls_suggested_client_id_fkey(...)`.

- [ ] **Step 1: Write the failing test** para a linha com CNPJ ausente do
      cadastro mas nome casável: `clientId` nulo, `suggestedClientId`
      preenchido, `reconciliationStatus: 'suggested_name'`; e para o override
      manual, que não pode virar `matched` sem documento.
- [ ] **Step 2: Run test to verify it fails** com `npx vitest run src/services/__tests__/graniteImport.test.ts src/pages/__tests__/Granite.behavior.test.tsx`.
- [ ] **Step 3: Write minimal implementation** usando `resolveCustomerLink`
      (mapeando `matched_document` → `matched`, `matched_name` →
      `suggested_name`), estendendo `ReconciliationBadge` (`Granite.tsx:474`) e
      qualificando os embeds.
- [ ] **Step 4: Run test to verify it passes** com o mesmo comando, mais
      `npx vitest run src/pages/__tests__/Granite.behavior.test.tsx src/services/__tests__/graniteBillingWorkflow.test.ts`.
- [ ] **Step 5: Commit** com `git add src/services/graniteImport.ts src/services/graniteCharges.ts src/pages/Granite.tsx src/hooks/useReview.ts src/services/__tests__ src/pages/__tests__ && git commit -m "fix(granito): tratar match por nome como sugestao, nao vinculo"`.

### Task 8: Filas de revisão exibindo a sugestão

**Files:**
- Modify: `src/hooks/useReview.ts`
- Modify: `src/pages/Revisao.tsx` (ou o componente de item da fila)
- Modify: `src/components/billing/ValidacaoOperationsTable.tsx`
- Test: `src/pages/__tests__/Revisao.test.tsx`

**Interfaces:**
- A query de granito (`useReview.ts:66`) mantém `.is('client_id', null)` e passa
  a selecionar `suggested_client_id` com o join do cliente sugerido.
- A fila mostra "Sugerido: <cliente>" com ação de confirmar, que chama o RPC de
  revisão existente — a confirmação humana é o que cria o vínculo.
- `renderReconciliationStatus` (`ValidacaoOperationsTable.tsx:304`) ganha o
  rótulo de sugestão.

- [ ] **Step 1: Write the failing test** garantindo que um granito com
      `client_id` nulo e sugestão aparece na fila com o nome sugerido e sem
      estado de "vinculado".
- [ ] **Step 2: Run test to verify it fails** com `npx vitest run src/pages/__tests__/Revisao.test.tsx`.
- [ ] **Step 3: Write minimal implementation** do select, do rótulo e da ação.
- [ ] **Step 4: Run test to verify it passes** com o mesmo comando.
- [ ] **Step 5: Commit** com `git add src/hooks/useReview.ts src/pages/Revisao.tsx src/components/billing/ValidacaoOperationsTable.tsx src/pages/__tests__/Revisao.test.tsx && git commit -m "feat(revisao): exibir cliente sugerido sem tratar como vinculo"`.

### Task 9: Backfill das linhas gravadas sob a regra antiga

**Files:**
- Create: `supabase/migrations/283_backfill_name_linked_customers.sql`
- Test: `src/services/__tests__/backfillNameLinkedCustomersMigration.test.ts`

**Interfaces:**
- B/Ls: mover `customer_id` → `suggested_customer_id` e zerar o vínculo onde
  `customer_reconciliation_status = 'matched_name'`, excluindo
  `financial_status = 'invoiced'`; em seguida `PERFORM
  public.sync_customer_reconciliation_queue_for_bl(id)` e recomputar
  `review_status` pelos motivos canônicos. Aqui a proveniência é confiável: o
  status distingue automático de decidido (`reconciled`).
- Granito: **não** existe coluna de status, então a proveniência precisa de duas
  condições combinadas, não de uma. Mover para `suggested_client_id` apenas as
  linhas que satisfaçam **todas**:
  1. `regexp_replace(shipper_cnpj, '\D', '', 'g')` diferente do `cnpj_cpf`
     normalizado do cliente vinculado (indício de match por nome);
  2. **sem** decisão humana registrada — não existe linha em `audit_logs` com
     `entity_type = 'granite_bl'`, `entity_id = granite_bls.id::text`,
     `field_name = 'client_id'` e `new_value = client_id::text`
     (`148_save_granite_bl_review_atomic.sql:33-44` grava exatamente isso, e o
     operador pode legitimamente escolher um cliente com documento diferente);
  3. sem faturamento — nada em `invoice_granite_bls` e `charge_status` não
     faturado.
  Linhas que batem (1) mas têm decisão humana ficam como estão: o vínculo é
  legítimo por decisão, não por nome.

- [ ] **Step 1: Write the failing test** (contrato SQL) verificando as três
      exclusões — `invoiced` em `bls`, decisão humana em `audit_logs` no
      granito, e granito já faturado — e a chamada de
      `sync_customer_reconciliation_queue_for_bl`.
- [ ] **Step 2: Run test to verify it fails** com `npx vitest run src/services/__tests__/backfillNameLinkedCustomersMigration.test.ts`.
- [ ] **Step 3: Write minimal implementation** do backfill, idempotente
      (rodar duas vezes não muda nada além da primeira).
- [ ] **Step 4: Run test to verify it passes** com o mesmo comando.
- [ ] **Step 5: Contar o impacto antes de aplicar** — rodar as consultas de
      diagnóstico em somente-leitura e registrar as contagens no PR, separando
      "moveria" de "preservaria por decisão humana"; se o segundo grupo for
      grande, revisar o critério antes de aplicar.
- [ ] **Step 6: Commit** com `git add supabase/migrations/283_backfill_name_linked_customers.sql src/services/__tests__/backfillNameLinkedCustomersMigration.test.ts && git commit -m "fix(db): devolver a fila os clientes vinculados por nome"`.

### Task 10: Caminhos mortos da fila de revisão

**Files:**
- Modify: `src/pages/revisaoHelpers.ts`
- Test: `src/pages/__tests__/Revisao.test.tsx`

**Interfaces:**
- Remover `groupNeedsPortal` (`revisaoHelpers.ts:103`) — o motivo
  `acesso ao portal nao provisionado` saiu do conjunto canônico na migration
  `188` — e `needsCeMercante` (`revisaoHelpers.ts:108`), cujo texto nenhum
  produtor jamais gravou; o bloqueio de CE vive em
  `src/components/billing/validacaoPipeline.ts:120`, outra fila.

- [ ] **Step 1: Confirmar que continuam mortos** com
      `rg -n "portal nao provisionado|ce mercante" supabase/migrations src` —
      se algum produtor tiver surgido, parar e registrar em vez de remover.
- [ ] **Step 2: Remover os predicados e seus usos**, ajustando os testes que os
      referenciam.
- [ ] **Step 3: Run tests** com `npx vitest run src/pages/__tests__/Revisao.test.tsx`.
- [ ] **Step 4: Commit** com `git add src/pages/revisaoHelpers.ts src/pages/__tests__/Revisao.test.tsx && git commit -m "chore(revisao): remover predicados sem produtor"`.

### Task 11: Documentação viva e encerramento

**Files:**
- Create: `docs/adr/0042-vinculo-de-cliente-somente-por-documento.md`
- Modify: `docs/adr/README.md`
- Modify: `CONTEXT.md`
- Modify: `docs/modules/clientes.md`
- Modify: `docs/RASTREABILIDADE.md`
- Modify: `docs/CHANGELOG.md`
- Move: `docs/plans/2026-08-11-vinculo-de-cliente-por-documento.md` → `docs/archive/plans/`
- Modify: `docs/plans/README.md`

**Interfaces:**
- ADR `0042` registra a decisão (vínculo por documento exato; sugestão em coluna
  própria; embeds qualificados; backfill com preservação de decisão humana) e
  aponta as migrations `280`–`283`.
- `CONTEXT.md` — nas entradas *Reconciliação de Cliente* e *Razão Social do
  Consignatário*, remover o apontamento de divergência: a regra passa a
  descrever o comportamento real.

- [ ] **Step 1: Escrever o ADR** e indexá-lo em `docs/adr/README.md`.
- [ ] **Step 2: Atualizar `CONTEXT.md`, `docs/modules/clientes.md` e `docs/RASTREABILIDADE.md`** com o novo fluxo (sugestão → fila → confirmação humana).
- [ ] **Step 3: Registrar a entrega em `docs/CHANGELOG.md`.**
- [ ] **Step 4: Mover este plano para `docs/archive/plans/`** e remover a linha de `docs/plans/README.md`, conforme `docs/CONVENCOES.md`.
- [ ] **Step 5: Verificação final** com `npm run docs:check`, `npm run lint`, `npm test` e `npm run build`.
- [ ] **Step 6: Commit** com `git add -A docs CONTEXT.md && git commit -m "docs: registrar a regra de vinculo de cliente por documento"`.

---

## Regressões a observar

Menos B/Ls passam a ter `customer_id` preenchido. Isso é o efeito desejado, mas
atinge consumidores que hoje usam `customer_id IS NOT NULL` como proxy de
"B/L pronto":

- Trigger de pendência de Portal (`190_portal_general_pendency.sql:57`) — deixa
  de disparar para B/L sem vínculo legítimo; correto, mas muda contagens de
  alerta.
- Views de omissão/transbordo (`201_voyage_omission_global_transshipment.sql:152`,
  `206_portal_notifications_bl_id.sql:89`, `215_rbac_voyages_customers_writes.sql:250`)
  — B/Ls casados por nome saem dessas listagens até a confirmação humana.
- Fila de reconciliação cresce: é onde o trabalho passa a aparecer. Vale medir o
  volume no Step 5 da Task 9 antes de aplicar o backfill.
- **Ordem de deploy:** as migrations que criam as segundas FKs (`280`, `282`) e
  as mudanças de embed (Tasks 5 e 7) precisam ir juntas. Uma migration aplicada
  sem o front atualizado quebra `/granito`, a fila de revisão e os relatórios
  com erro de relacionamento ambíguo do PostgREST.

## Fora de escopo

- Afrouxar ou reforçar o gate de faturamento (`275`) — permanece como está.
- Mudar os níveis de matching de `findMatchedCustomer`; o fuzzy continua útil
  como sugestão e não é ajustado aqui.
- Cadastro automático de cliente novo a partir do manifesto.
# Plano executado

Implementação concluída na PR 518. As etapas foram executadas nos commits da
branch, com migrations `280`–`283`, testes de contrato e documentação/ADR
atualizados. A aplicação do backfill exige executar primeiro as consultas de
impacto somente-leitura descritas na migration 283.

## Fechamento operacional

O código e as migrations foram publicados na branch da PR. Após o merge, a
sequência operacional é: aplicar as migrations, executar as consultas de
impacto em somente-leitura, registrar as contagens e então deixar a migration
283 realizar o backfill. A regeneração de `src/types/database.ts` também deve
ser feita contra o schema já migrado; não foi fabricada localmente porque o
Supabase/Docker não estava disponível e as migrations não devem ser aplicadas
antes do merge.
