# Vínculo de cliente por nome — divergência de regra de domínio

**Data:** 2026-08-11
**Origem:** auditoria de alertas e notificações, ao levantar os motivos de
`review_status = 'pending_review'`.
**Regra de domínio (definida pelo responsável do produto nesta data):** o
Cliente só pode ser vinculado a um B/L **por documento exato** — CNPJ para
pessoa jurídica, CPF para pessoa física, que o cadastro guarda na mesma coluna
`cnpj_cpf`. Match por nome não vincula, em nenhuma de suas formas.

Este documento é um registro histórico do achado. A correção não foi executada
nesta mudança.

## O que o código faz hoje

`findMatchedCustomer` (`src/services/customerReconciliation.ts:105`) resolve o
cliente em quatro níveis, nesta ordem:

1. CNPJ/CPF exato (`matchType: 'document'`);
2. razão social normalizada (`matchType: 'name'`);
3. nome canônico — sem acentos, pontuação ou sufixo legal (`matchType: 'name'`);
4. fuzzy Levenshtein ≥ 0.90, exigindo coincidência da primeira palavra
   (`matchType: 'name'`).

Os níveis 2 a 4 produzem um vínculo por nome. O problema não é a existência da
sugestão — é que **o `customer_id` é gravado no B/L mesmo quando o match veio
por nome**:

- `src/services/blFreightImport.ts:462` — `payload.customer_id = match?.customer.id ?? null`,
  sem distinguir `matchType`;
- `src/services/breakbulkImport.ts:68` — `customerId = matchedCustomer?.id ?? null`;
- `supabase/migrations/205_bl_document_fields.sql:131` — o RPC de importação
  persiste o `customer_id` recebido no payload junto de
  `customer_reconciliation_status = 'matched_name'`.

O B/L passa então a carregar um cliente que ninguém confirmou por documento.

## Por que o gate de faturamento não protege disso

O gate está correto e continua valendo: `mark_bl_ready_for_billing`
(`supabase/migrations/275_ready_gate_without_table_validity.sql:65`) exige
`customer_reconciliation_status IN ('matched_document', 'reconciled')`, e
`isCustomerReconciliationResolved` (`src/services/customerReconciliation.ts:166`)
usa o mesmo critério. Um B/L em `matched_name` não fatura.

O dano é anterior ao faturamento e não é coberto por esse gate:

1. **A pendência canônica de cliente deixa de existir.**
   `compute_bl_review_pendencies`
   (`supabase/migrations/188_review_gate_remove_portal.sql:21`) testa
   `p_customer_id IS NULL`. Com o `customer_id` preenchido por nome, o motivo
   `Cliente nao vinculado` **não** é gerado — o B/L some da fila de revisão por
   esse motivo, embora nenhum vínculo legítimo exista.

2. **O motivo textual que sinalizava o risco não sobrevive a um save.**
   `Cliente vinculado por nome; validar CNPJ` é gravado em `bls.notes` na
   importação (`171_bl_import_edi_fields.sql:645`, `166_bl_import_party_blocks.sql:630`)
   e não pertence ao conjunto canônico. Como `save_bl_review` recomputa
   `review_status` só pelos canônicos (`205_bl_document_fields.sql:827`), a
   primeira edição do B/L apaga o sinal sem que CNPJ nenhum tenha sido validado.

3. **A pendência de e-mail passa a ser avaliada contra o cliente errado.** O
   motivo `Cliente sem e-mail cadastrado` consulta os contatos do
   `customer_id` gravado. Se o vínculo por nome apontou para outro cadastro, a
   ausência ou presença de e-mail é lida do cliente errado.

4. **Granito não tem sequer o estado intermediário.**
   `src/services/graniteImport.ts:122-126` chama o mesmo `findMatchedCustomer` e
   colapsa qualquer resultado em `reconciliationStatus = 'matched'`, gravando
   `clientId` sem distinguir documento de nome. Um match fuzzy vira cliente
   reconciliado, sem pendência e sem trava. É a instância mais grave do achado.
   O mesmo padrão aparece em `src/pages/Granite.tsx:94`.

## Correção necessária

> **Nota editorial (2026-08-11):** o esboço abaixo virou plano vivo em
> [`docs/plans/2026-08-11-vinculo-de-cliente-por-documento.md`](../../plans/2026-08-11-vinculo-de-cliente-por-documento.md),
> que é a versão executável e corrige dois pontos deste esboço: o par
> `manifest_customer_name` / `manifest_customer_cnpj_cpf` **não** serve de
> estacionamento para a sugestão (guarda texto de manifesto, não id de cliente,
> e não existe em `granite_bls`), e a fila de granito depende do filtro
> `.is('client_id', null)` em `src/hooks/useReview.ts:66`.

Ainda não executada. O ponto de correção é o compartilhado, não cada call site:

- `findMatchedCustomer` deve deixar de produzir vínculo por nome, ou os callers
  devem parar de gravar `customer_id` quando `matchType !== 'document'`,
  preservando a sugestão em campo separado (o par
  `manifest_customer_name` / `manifest_customer_cnpj_cpf` já existe para isso).
- `graniteImport.ts` e `Granite.tsx` precisam distinguir documento de nome antes
  de gravar `client_id`.
- Revisar os B/Ls já gravados em `matched_name`: o `customer_id` deles foi
  escrito sob a regra antiga.
- Decidir o destino do texto `Cliente vinculado por nome; validar CNPJ`. Se o
  vínculo por nome deixar de existir, o motivo perde objeto e sai junto.

## Achados colaterais (mesma varredura)

Dois predicados da fila de revisão testam motivos que nada mais produz:

- `groupNeedsPortal` (`src/pages/revisaoHelpers.ts:103`) procura
  `acesso ao portal nao provisionado`, motivo removido do conjunto canônico
  pela migration 188.
- `needsCeMercante` (`src/pages/revisaoHelpers.ts:108`) procura `ce mercante`.
  Nenhum produtor de motivo — SQL ou TypeScript — jamais gravou esse texto. O
  bloqueio por CE Mercante vive em `src/components/billing/validacaoPipeline.ts:120`,
  que é outra fila.

Ambos são caminhos mortos: não causam dano, mas sugerem cobertura que não existe.
