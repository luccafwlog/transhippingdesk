## Relatório — Módulo Faturamento

### Tabelas e funções auditadas

### Frontend/componentes
- `src/pages/Faturamento.tsx`: abas Validação, Pendências, Invoices e Demurrage; emissão de invoice; listagem/pagamento/cancelamento; integra também visão financeira de Demurrage, mas o módulo Demurrage não foi alterado.
- `src/components/billing/ValidacaoTab.tsx`: fila operacional para conciliação, revisão e pronto faturar; ações em lote de recalcular, aprovar revisão e marcar pronto; emite invoice local automaticamente ao marcar pronto.
- `src/pages/TaxasLocais.tsx`: cadastro de tabelas, itens e overrides; pendências operacionais foram removidas daqui e movidas para Faturamento.
- `src/components/billing/InvoiceDocumentLocal.tsx`: renderização/documento de invoice local.
- `src/components/demurrage/InvoiceDocument.tsx`: apenas usado na aba financeira agregada; sem alteração planejada.

### Hooks
- `src/hooks/useBilling.ts`: queries/mutations de invoices, B/Ls prontos, clientes, pagamentos e cancelamento.
- `src/hooks/useLocalCharges.ts`: queries/mutations de cálculo local, operações, tabelas, overrides, conciliação e lote.
- `src/hooks/useOperationalCounts.ts`: badges do menu; `chargeReviewRequired` conta `bls.charge_status = 'review_required'`, `readyForBilling` conta `bls.charge_status = 'ready_for_billing'`.
- `src/hooks/useBls.ts`: listagens de B/Ls e resumo operacional usado fora do módulo financeiro.

### Serviços
- `src/services/billing.ts`: `listInvoices`, `listInvoiceDetails`, `listBillingReadyBls`, `listBillingReadyGraniteBls`, `createInvoiceFromBls`, `createInvoiceFromGraniteBls`, `registerInvoicePayment`, `cancelInvoice`, `listInvoiceLinksByBls`, `listBillingCustomers`.
- `src/services/charges/chargeOperationsService.ts`: `calculateBlLocalCharges`, `listLocalChargeOperationalRows`, `listBlLocalChargeLines`, `markBlReadyForBilling`, `markLocalCharges*Batch`, `listBillingRuns`, `getBillingRunDetails`.
- `src/services/charges/chargeTableService.ts`: CRUD de `charge_tables` e `charge_table_items`.
- `src/services/charges/chargeRateService.ts`: CRUD de `customer_rate_overrides` e listas auxiliares.
- `src/services/charges/chargeReconciliationService.ts`: fila e aprovação/rejeição de conciliação de cliente.
- `src/services/graniteCharges.ts`: cálculo próprio do módulo Granito para `granite_bl_charges`.
- `src/services/manifestImport.ts` e `src/services/breakbulkImport.ts`: criação de B/Ls via manifesto e disparo de cálculo automático.

### Edge Functions
- `supabase/functions/notify-invoice-issued/index.ts`: webhook em `invoices` para notificação quando invoice muda para `issued`.
- `supabase/functions/provision-portal-user/index.ts`: portal de cliente; não emite invoice diretamente, mas toca permissões/contas relacionadas.

### Tabelas Supabase mapeadas
- Entrada/importação: `import_batches`, `bls`, `bl_containers`, `bl_breakbulk_items`, `vehicles`, `customers`, `customer_contacts`.
- Taxas locais: `charge_tables`, `charge_table_items`, `charge_calculations`, `customer_rate_overrides`, `billing_runs`, `billing_run_logs`, `customer_reconciliation_queue`.
- Invoices locais: `invoices`, `invoice_items`, `invoice_bls`, `payments`, `billing_batches`, `invoice_counters`.
- Granito: `granite_manifests`, `granite_bls`, `granite_rates`, `granite_bl_charges`, `invoice_granite_bls`.
- Demurrage: `demurrage_invoices`, `demurrage_invoice_items`, `demurrage_rates`; mapeadas por dependência de tela, sem alteração.

### RPCs/funções Supabase auditadas
- `calculate_bl_local_charges(p_bl_id, p_actor, p_recalculate)`
- `resolve_local_charge_table_id(p_cargo_mode, p_pod, p_reference_date)`
- `normalize_port_code(p_value)`
- `mark_bl_charges_reviewed(p_bl_id, p_actor)`
- `mark_bl_ready_for_billing(p_bl_id, p_actor)`
- `create_invoice_from_bls(p_bl_ids, p_customer_id, p_due_date, p_notes, p_issue_now, p_actor)`
- `create_invoice_from_bls_core(...)`
- `create_invoice_from_granite_bls(...)`
- `register_invoice_payment(...)`
- `cancel_invoice(...)`
- `run_billing_for_import_batch(...)`
- `approve_customer_reconciliation(...)`, `reject_customer_reconciliation(...)`, `list_customer_reconciliation_queue(...)`

## Mapa de selects/inserts/updates principais

### Manifesto / BL
- `breakbulkImport.ts`: `import_batches.insert`, `bls.upsert`, `bl_breakbulk_items.delete/insert`, `import_errors.insert`, `import_batches.update`, depois `calculateBlLocalCharges` por B/L.
- `manifestImport.ts`: usa RPCs transacionais de manifesto e popula `bls`/`bl_containers` via banco.
- `baplieReconciliation.ts`: `bls.select`, `baplie_containers.select`, `bl_containers.update`, `audit_logs.insert`.

### Cálculo local
- `calculate_bl_local_charges`: lê `bls`, `import_batches`, `vehicles`, `bl_containers`, `charge_tables`, `charge_table_items`, `customer_rate_overrides`; grava `charge_calculations`; atualiza `bls.charge_status`, `charges_calculated_at`, `charge_exemption_reason`.
- `listLocalChargeOperationalRows`: lê `bls`, `charge_calculations`, `audit_logs`; para Granito lê `granite_bls`, `granite_bl_charges`.
- `mark_bl_ready_for_billing`: lê `bls`, `charge_calculations`, `charge_tables`; atualiza `charge_calculations.status`, `bls.charge_status`, `bls.billing_hold_reason`; grava `audit_logs`.
- PTAX/BCB: não participa de Taxas Locais/Faturamento local. Linhas USD bloqueiam o avanço para faturamento local; conversão PTAX fica restrita ao fluxo Demurrage, que não foi alterado.

### Invoice local
- `listInvoices`: lê `invoice_bls` para filtro por B/L; lê `invoices` com join em `customers` e `invoice_bls`.
- `create_invoice_from_bls_core`: trava `bls FOR UPDATE`; valida status/cliente/conflitos/USD; insere `billing_batches` quando lote; insere `invoices`, `invoice_bls`, `invoice_items`; atualiza `invoices.total_brl/balance_brl`; atualiza `bls.financial_status = 'invoiced'`; grava `audit_logs`.
- `register_invoice_payment`: trava `invoices FOR UPDATE`; insere `payments`; atualiza `invoices.total_paid_brl/balance_brl/status`; atualiza `bls.financial_status`; grava `audit_logs`.
- `cancel_invoice`: trava `invoices FOR UPDATE`; atualiza `invoices`, `billing_batches`, `bls.financial_status`; após correção, também atualiza `granite_bls.charge_status`; grava `audit_logs`.

### Invoice Granito
- `listBillingReadyGraniteBls`: lê `granite_bls` com join em `customers` e `granite_manifests`.
- `create_invoice_from_granite_bls`: antes da correção, não validava sessão/admin, não travava `granite_bls` e bloqueava reemissão mesmo com invoice cancelada. Corrigido em migration `20260528134131_fix_granite_invoice_cancel_reissue.sql`.

### Problemas encontrados

| # | Descrição | Severidade | Status |
|---|---|---|---|
| 1 | Invoices de Granito não podiam ser reemitidas após cancelamento, porque `create_invoice_from_granite_bls` bloqueava qualquer vínculo em `invoice_granite_bls`, inclusive cancelado. | Alta | Corrigido em migration |
| 2 | Cancelamento de invoice não devolvia `granite_bls.charge_status` para `ready_for_billing`, deixando B/L Granito órfão/invoiced após cancelar. | Alta | Corrigido em migration |
| 3 | `create_invoice_from_granite_bls` não tinha o mesmo gate explícito de `auth.uid()`, `is_active_user()` e `is_admin()` usado na emissão local. | Alta | Corrigido em migration |
| 4 | `create_invoice_from_granite_bls` não travava `granite_bls FOR UPDATE`, abrindo risco de corrida entre dois usuários faturando o mesmo B/L Granito simultaneamente. | Alta | Corrigido em migration |
| 5 | Pendências estavam em Taxas Locais, misturando cadastro tarifário com operação de faturamento. | Média | Corrigido: nova aba Pendências em Faturamento |
| 6 | Abas de Faturamento tinham visual diferente de Taxas Locais. | Baixa | Corrigido: usa `.app-tab`/`.app-tab--active` |
| 7 | Fila operacional usava consulta única com limite fixo, criando risco de ocultar B/Ls em volume alto. | Média | Corrigido: paginação interna em `listLocalChargeOperationalRows` |
| 8 | Vínculo ativo duplicado podia ser inserido diretamente em `invoice_bls`/`invoice_granite_bls`, fora das RPCs. | Alta | Corrigido em migration com triggers de integridade |
| 9 | B/L container sem container vinculado podia receber linha fixa `bl` e avançar como calculado em vez de ir para Pendências. | Alta | Corrigido em migration com trigger `trg_guard_container_bl_without_containers` |

### Evidências de cálculo

Consulta ao banco em 2026-05-28 mostrou, antes do reset/esvaziamento posterior da base operacional, que os 10 B/Ls BB `CX38TCVT01` a `CX38TCVT10`, antes em revisão por ausência de tabela, estavam `ready_for_billing`, POD `BRVIX`, com 2 linhas cada: `BL Fee` e `THD`.

| B/L | Linhas | Fórmula observada | Total |
|---|---|---|---|
| `CX38TCVT01` | `BL Fee` + `THD` | `1 x 600,00` + `153,510 t x 62,50 = 9.594,38` | `10.194,38` |
| `CX38TCVT03` | `BL Fee` + `THD` | `1 x 600,00` + `81,158 t x 62,50 = 5.072,38` | `5.672,38` |
| `CX38TCVT05` | `BL Fee` + `THD` | `1 x 600,00` + `32,305 t x 62,50 = 2.019,06` | `2.619,06` |

Fixtures transacionais com rollback executadas no Supabase para container:

| Cenário | Fórmula esperada | Resultado observado |
|---|---|---|
| Container padrão com 2 contêineres | `BL Fee 50` + `THD standard 2 x 100` + `ISPS 2 x 10` = `270` | Linhas `50 + 200 + 20`; status pronto após promoção |
| Container com 1 IMO e 1 OOG separados | `BL Fee 50` + `THD IMO 1 x 200` + `THD OOG 1 x 300` + `ISPS 2 x 10` = `570` | Linhas `50 + 200 + 300 + 20`; status pronto após promoção |
| Container com IMO+OOG no mesmo contêiner | `BL Fee 50` + `ISPS 1 x 10`; THD bloqueado para revisão | Linha `review:imo_oog_thd` com mensagem clara; status `review_required` |

Contagem observada após cadastro/recalculo:

| Modo | Status | Qtde |
|---|---|---:|
| `carga_solta` | `ready_for_billing` | 10 |
| `container` | `ready_for_billing` | 62 |
| `container` | `not_calculated` | 86 |

Na verificação posterior, a base operacional atual retornou `bls=0`, `granite_bls=0` e `invoices=0`; portanto os badges atuais tenderiam a zero. A evidência dos 72 prontos deve ser tratada como snapshot da execução anterior, não como estado vivo atual.

### Evidências de persistência e badges

- Valores calculados locais são persistidos em `charge_calculations`, não ficam apenas em memória.
- Status operacional do B/L é persistido em `bls.charge_status`; status financeiro local em `bls.financial_status`.
- O badge de Taxas Locais/Faturamento vem de `useOperationalCounts`, com queries `head: true` e `count: exact` contra `bls`; pode ficar stale apenas até o próximo refresh/invalidate do React Query.
- `invoices.invoice_number` possui constraint `UNIQUE` (`invoices_invoice_number_key`).
- Duplicidade ativa de B/L em invoices foi reforçada na migration com triggers `trg_prevent_duplicate_active_invoice_bl_link` e `trg_prevent_duplicate_active_invoice_granite_bl_link`.
- Fixture transacional confirmou que tentativa de segundo vínculo ativo em `invoice_bls` é bloqueada: o total de vínculos ativos permaneceu `1`.
- B/L container sem `bl_containers` válido é forçado para `review_required` pelo trigger `trg_guard_container_bl_without_containers`; fixture com rollback confirmou `review:no_container` e `billing_hold_reason` claro.
- A paginação interna da fila operacional tem teste automatizado simulando 1005 B/Ls e confirmando ranges `0-999` e `1000-1004`.

### Regra de snapshot

O faturamento local emite a invoice a partir das linhas já persistidas em `charge_calculations`. Portanto, alterar uma tabela de taxas depois do cálculo não altera automaticamente uma invoice futura daquele B/L: o usuário deve recalcular o B/L antes de faturar se quiser usar a nova tabela/regra. Esse comportamento evita que uma invoice mude silenciosamente por alteração posterior de cadastro tarifário.

### Stress-test

| Cenário | Observado | Esperado | ✅/❌ |
|---|---|---|---|
| BL sem container ou sem peso/tipo | `weight_ton` ausente gera `review_required`; container sem contêiner válido agora é forçado para `review_required` com `review:no_container`. | Ir para Pendências com mensagem clara. | ✅ |
| Taxa não cadastrada para o POD | `calculate_bl_local_charges` gera linha `review:no_table`, `charge_status = review_required`, razão clara. | Pendências, não zero silencioso. | ✅ |
| CNPJ do cliente não encontrado | `run_billing_for_import_batch` bloqueia com `billing_hold_reason`; BB import agora preserva reconciliação quando há match por documento. | Tratar explicitamente. | ⚠️ Parcial |
| Double-click em Faturar | Local usa lock `bls FOR UPDATE`, valida `financial_status` e trigger de vínculo ativo; fixture confirmou bloqueio de segundo vínculo ativo. Granito corrigido com lock/status/trigger. | Não duplicar invoice. | ✅ |
| Dois usuários faturando mesmo BL simultaneamente | Local protegido por row lock em `bls`; Granito corrigido com row lock em `granite_bls`; triggers bloqueiam insert direto duplicado. | Race tratada. | ✅ |
| Reload durante faturamento | Persistência é no banco/RPC transacional; UI refaz queries. | Estado não corrompido. | ✅ |
| 100+ BLs na fila | Serviço agora busca a fila operacional em páginas internas de 1000 até o limite solicitado; tela mantém ação em lote sobre o conjunto carregado. | Query paginada/sem timeout. | ✅ |
| Lote de 50+ BLs | Batch client-side executa sequencialmente; pode ser lento, mas não estoura request único. | Concluir sem limite de request. | ✅ |
| Cancelamento de invoice | Local volta `bls.financial_status` para pending quando não há outra invoice ativa/paga; Granito corrigido. | BL retorna para Validação/pronto. | ✅ |
| Alterar tabela de taxas após cálculo, antes de faturar | Invoice usa snapshot de `charge_calculations` no momento da emissão; não recalcula automaticamente. Regra documentada: recalcular antes de faturar se quiser a nova tabela. | Recalcula manualmente ou mantém snapshot documentado. | ✅ |

### Recomendações pendentes

- Transformar as fixtures SQL transacionais de cálculo/concorrência em testes de integração opt-in quando houver ambiente Supabase isolado para CI.

### Verificações executadas

- `npm test -- src/services/__tests__/localCharges.test.ts`: 8 testes passaram, incluindo paginação operacional de 1005 B/Ls.
- `npm test`: 70 testes passaram e 6 ficaram skipped.
- `npm run build`: build TypeScript/Vite passou.
- Migration `20260528134131_fix_granite_invoice_cancel_reissue.sql`: triggers de integridade validados no Supabase em transação com `ROLLBACK`.
- Fixtures de cálculo container executadas no Supabase com rollback: standard, IMO/OOG separados, IMO+OOG dual e container sem contêiner.
- Fixture de duplicidade ativa executada no Supabase com rollback: segunda tentativa de vínculo em `invoice_bls` foi bloqueada e a contagem permaneceu `1`.




