# 0014 — Demurrage: recálculo diário substitui ROE congelado na emissão

Status: aceito — 2026-06-24

## Contexto

O modelo original de Demurrage (ver 0008) congelava o ROE no momento da
emissão da invoice (`frozen_roe`, `frozen_total_brl`) e tratava o markup de
1,065 como margem de proteção cambial. Na prática, o processo de negócio do
armador é outro: o valor em BRL de uma fatura **não paga** deve acompanhar a
PTAX divulgada diariamente pelo BCB, e o markup de 1,065 é um **spread fixo do
armador**, não proteção contra flutuação. O congelamento na emissão produzia
valores defasados, vencimentos (`due_date`/`overdue`) sem sentido sob recálculo
diário e divergências na conciliação PIX.

## Decisão

Enquanto a invoice de Demurrage não estiver paga, seu valor em BRL é
recalculado a cada nova PTAX:

- O valor em USD é estável (referência para o cliente); o valor em BRL é
  dinâmico: `total_brl = (total_usd − desconto_usd) × ptax × 1,065`.
- As colunas que guardam o último valor recalculado deixam de se chamar
  `frozen_roe`/`frozen_total_brl` e passam a `current_roe`/`current_total_brl`,
  refletindo que não há mais congelamento na emissão. O congelamento real
  ocorre apenas no pagamento, registrado de forma imutável em
  `demurrage_invoice_history`.
- O desconto é sempre expresso e aplicado em USD, antes da conversão.
- Vencimento e status `overdue` deixam de existir para Demurrage; a fatura
  nasce `issued`.

Arquitetura de execução do recálculo:

- **RPC núcleo** `recalculate_demurrage_invoices(p_ptax, p_source)`:
  `SECURITY DEFINER`, **sem** checagem de `auth.uid()`, executável apenas por
  `service_role` (mesmo padrão do antigo `mark_overdue_invoices`). É quem
  recalcula e grava o histórico.
- **Wrapper manual** autenticado, chamado pelo operador (modal "Informar PTAX"),
  que valida `auth.uid()`/`is_active_user()` e delega à núcleo com
  `source='manual'`.
- **Edge Function agendada** (dias úteis, após ~14h) busca a PTAX no BCB
  server-side e chama a núcleo via `service_role` com `source='bcb_live'`.
  pg_cron puro não serve porque o recálculo depende de HTTP externo ao Postgres.

## Consequências

- **Positivas**: o valor cobrado reflete o câmbio corrente; o histórico
  imutável dá auditoria e base para conciliação; separar núcleo/wrapper evita o
  bug de um job sem sessão de usuário cair no guard `auth.uid()`.
- **Negativas / custos**: renomear `frozen_*` toca arquivo protegido
  (`src/types/database.ts`) e ~27 arquivos; passa a existir infra de Edge
  Function + agendamento a operar e monitorar; faturas emitidas após o job do
  dia precisam de uma entrada inicial de histórico na própria emissão.
- **Relação**: estende a 0008 (Demurrage segue em persistência própria), apenas
  troca o modelo de valor congelado-na-emissão por recálculo diário.
