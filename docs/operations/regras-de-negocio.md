# Regras de negócio

> Regras **não óbvias** que atravessam módulos. Regras específicas de cada módulo ficam no doc do módulo. Termos em [CONTEXT.md](../../CONTEXT.md).

---

## Gate de faturamento

Um B/L só pode ser faturado depois de passar por dois portões (ADR 0006):

1. **Revisão manual** — o gate canônico bloqueia cliente ausente, cliente sem e-mail, portal sem conta ativa vinculada ao Supabase Auth e peso BB ausente em carga solta. **CE Mercante não bloqueia a revisão/fatura**; ela é um gate separado de visibilidade no Portal. Ver [Revisão](../modules/operacao-suporte.md#revisão).
2. **Reconciliação de cliente** — o B/L precisa estar vinculado a um `customer` de forma segura; casos ambíguos ficam em `customer_reconciliation_queue` e bloqueiam o faturamento até resolução manual. Ver [Clientes](../modules/clientes.md).

O banco é a fonte da verdade: `save_bl_review` calcula e audita o status real; o gate roda após novas importações e novamente ao promover/faturar. A correção de 2026-06-19 é prospectiva e não reabre B/Ls históricos já faturados. Prefere-se travar a emissão a emitir uma invoice para o cliente errado.

## Numeração de invoices

A numeração sequencial é atômica no banco, via RPC `assign_invoice_number` sobre `invoice_counters`. Nunca gerar número no cliente — garante unicidade fiscal mesmo sob concorrência. Detalhes em [Faturamento](../modules/faturamento.md).

## Ledger local e ciclo de vida

Taxas locais usam um **ledger local** (ADR 0007) como fonte de saldo:

- `bl_receivables` — saldo a receber por B/L.
- `invoice_receivable_links` — liga invoices (individuais e consolidadas) aos receivables.
- `ledger_settlements` — baixas/pagamentos.
- `invoice_lifecycle_events` — trilha de eventos da invoice.

Demurrage **não** entra no ledger local — mantém persistência própria (`demurrage_invoices`), mas é exibido de forma unificada em Faturamento, Conciliação PIX e Portal (ADR 0008).

## Overdue / inadimplência

- `mark_overdue_invoices` / `detect_overdue_invoices` marcam faturas vencidas.
- `fn_block_invoice_overdue_customer` **bloqueia novas emissões** para clientes com fatura vencida.
- A comparação de vencimento é por **dias de calendário** (não por timestamp). Ver [Faturamento](../modules/faturamento.md).

## Bloqueio de faturamento por cliente (billing block)

O cliente pode ter um motivo de bloqueio de faturamento persistido. A migration `126_preserve_customer_billing_block_reason.sql` deixou de **inferir** um motivo genérico durante a importação — o motivo só é definido por ação explícita, preservando o que já existir. Ver [Clientes](../modules/clientes.md).

## Câmbio (ROE / PTAX)

Cobranças em moeda estrangeira usam o ROE obtido da PTAX Venda do Banco Central (`olinda.bcb.gov.br`) pelo serviço compartilhado `fetchROE`, com markup canônico de `1,065`. O header interno consome esse contrato por `useRoeHeaderRate`; sem ROE/dados fiscais suficientes, a emissão da invoice é bloqueada. Aplica-se a Faturamento e Demurrage.

## Reconciliação de cliente (fuzzy matching)

Na importação documental de container, o consignatário do B/L é casado contra a base de `customers` por CNPJ e por similaridade de nome. Match incerto entra em `customer_reconciliation_queue` em vez de vincular automaticamente. Ver [Clientes](../modules/clientes.md). Conforme a ADR 0025, o arquivo de B/L é a fonte documental da carga de container; o importador de Manifesto CNTR foi removido do frontend.

## Confirmação de exclusões persistidas

Toda ação que apaga ou remove um registro já persistido exige diálogo explícito
de confirmação, mesmo sem B/Ls ou outras dependências. O diálogo identifica o
objeto, informa consequências conhecidas e usa uma ação nominal como `Excluir`.
Remover linha ainda não salva, limpar filtro, desfazer seleção ou cancelar edição
não pertence a esse contrato.

## Conciliação Baplie ↔ B/L

- Match key: `container_number` + `voyage_id`. `bl_ref` do Baplie é sinal secundário, não critério de bloqueio.
- **Divergência de existência** (container no Baplie sem correspondência nos B/Ls) → aviso, sem bloqueio.
- **Divergência de atributo** (status full/empty, IMO, OOG conflitantes) → aviso, com opção de aceitar valor do Baplie por linha.
- O Baplie pode sobrescrever flags operacionais (`is_imo`, `imo_class`, `un_number`, `is_oog`, `status`); dados documentais e financeiros vêm do B/L e permanecem protegidos.

Detalhes em [Manifestos & EDI](../modules/manifesto-edi.md). Definições em [CONTEXT.md](../../CONTEXT.md).

## Conciliação PIX

- Invoices locais são conciliadas por TXID via `reconcile_invoice_payment_by_txid`, que registra ledger/payment/settlement e marca a invoice com `pix_txid` e `conciliated_by_extract`.
- Demurrage é marcado diretamente em `demurrage_invoices` (`status = paid`, `paid_at`, `pix_txid`, `conciliated_by_extract`).
- **Casos ambíguos** (TXID repetido, valor divergente, múltiplos candidatos) **não** são confirmados automaticamente — ficam para revisão humana. Ver [Conciliação PIX](../modules/reconciliacao-pix.md).

## Gate de CE Mercante no Portal

O Portal do Cliente só expõe dados de B/Ls que tenham `ce_mercante` preenchido (migration `123_portal_ce_mercante_gate.sql`). Evita mostrar carga ainda não declarada no Mercante. Ver [Portal do Cliente](../modules/portal-cliente.md).

## Hard delete controlado

Entidades operacionais permitem **hard delete**, mas exclusões são bloqueadas por vínculos fiscais e registradas em auditoria (ADR 0009). A trilha fica em `audit_logs` (services `deleteAudit.ts`, `deleteDependencies.ts`).

## Escritas best-effort

Algumas escritas (alertas, eventos operacionais, payload PIX) **logam e seguem** em vez de falhar a operação principal. É proposital para não travar o fluxo financeiro, mas pode mascarar falhas — monitorar via [Sentry](seguranca.md).
