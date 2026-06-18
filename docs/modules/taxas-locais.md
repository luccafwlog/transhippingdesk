# Taxas Locais

> **Status:** ativo · **Atualizado:** 2026-06-18 · **Rotas:** `/taxas-locais`

## Propósito

Gerencia as tabelas de preços de taxas locais (THC, capatazia, etc.) e os overrides comerciais por cliente, e calcula os charges por B/L que alimentam o [Faturamento](faturamento.md). Cada tabela é escopada por `cargo_mode`, POD e janela de validade; o cálculo resolve o item aplicável, aplica override do cliente quando existir e produz linhas em `charge_calculations` com um workflow de status (calculado → revisado → ready_for_billing).

## Como funciona

A operação cadastra `charge_tables` e seus `charge_table_items` na aba Tabelas e os `customer_rate_overrides` na aba Overrides. No fluxo do B/L, `calculate_bl_local_charges` resolve a tabela ativa por `cargo_mode`/POD/data, gera as linhas de charge (base + other charges), aplica overrides e marca `review_required` quando há ambiguidade (sem tabela, peso ausente, IMO+OOG). A operação então revisa e libera para faturamento.

## Componentes e arquivos

| Camada | Arquivo | Responsabilidade |
|--------|---------|------------------|
| Página | [`src/pages/TaxasLocais.tsx`](../../src/pages/TaxasLocais.tsx) | Página com abas Tabelas e Overrides, controladas por role |
| Página (helper) | [`src/pages/taxasLocaisHelpers.ts`](../../src/pages/taxasLocaisHelpers.ts) | Validação e normalização dos formulários |
| Hook | [`src/hooks/useLocalCharges.ts`](../../src/hooks/useLocalCharges.ts) | React Query: queries/mutations de tabelas, overrides e operações de charge |
| Service | [`src/services/charges/chargeTableService.ts`](../../src/services/charges/chargeTableService.ts) | CRUD de `charge_tables` e `charge_table_items` |
| Service | [`src/services/charges/chargeRateService.ts`](../../src/services/charges/chargeRateService.ts) | CRUD de `customer_rate_overrides`; resolução de valor efetivo |
| Service | [`src/services/charges/chargeOperationsService.ts`](../../src/services/charges/chargeOperationsService.ts) | Orquestra RPCs de cálculo, charges manuais e transições de status; unifica `bls` + `granite_bls` |
| Service | [`src/services/charges/chargeReconciliationService.ts`](../../src/services/charges/chargeReconciliationService.ts) | Fila de reconciliação de cliente (consumida pelo gate do faturamento) |
| Componente | [`src/components/taxasLocais/ChargeTablesTab.tsx`](../../src/components/taxasLocais/ChargeTablesTab.tsx) | UI de CRUD de tabelas e itens |
| Componente | [`src/components/taxasLocais/ChargeOverridesTab.tsx`](../../src/components/taxasLocais/ChargeOverridesTab.tsx) | UI de CRUD de overrides por cliente |
| Componente | [`src/components/taxasLocais/chargeForms.ts`](../../src/components/taxasLocais/chargeForms.ts) | Tipos de formulário e defaults |

## Regras de negócio

- **Escopo da tabela:** `resolve_local_charge_table_id(cargo_mode, pod, reference_date)` retorna a `charge_tables` ativa cujo escopo (`cargo_mode` ∈ container/carga_solta/granito, POD normalizado, janela `valid_from`/`valid_to`) bate com o B/L. `normalize_port_code()` trata aliases (ex. BRVIT/BRSSA); PODs fora da lista passam sem normalização.
- **Resolução de valor (precedência):** valor base vem de `charge_table_items.unit_value_brl`/`unit_value_usd`. Se existir `customer_rate_overrides` para o `customer_id` + `charge_item_id` vigente na `reference_date` (`valid_from`/`valid_to`), o override mais recente (`ORDER BY created_at DESC LIMIT 1`) substitui o valor e a linha recebe `override_applied = true`.
- **`application_basis`** do item determina a quantidade: `bl`, `container_distinct_voyage`, `weight_ton` ou `teu`. Para `weight_ton` sem peso válido no B/L, a linha vira `review_required` (não é ignorada).
- **Auto-review:** `calculate_bl_local_charges` marca `review_required` quando não há tabela ativa, peso ausente em charge por tonelada, ou container simultaneamente `is_imo` e `is_oog` (THD exige revisão manual). Carga LCL/veículo pode resultar em `exempt`.
- **Workflow de status (`bls.charge_status`):** `not_calculated` → `calculated`/`review_required` (via cálculo) → `reviewed` (`mark_bl_charges_reviewed`) → `ready_for_billing` (`mark_bl_ready_for_billing`, exige zero linhas `review_required` e tabela ativa válida); `exempt` para isenção. Charges manuais entram já como `reviewed`.
- **Charge tabela obrigatória:** a partir da migration 030, `ready_for_billing` exige tabela ativa correspondente ao POD/modo — sem ela a transição falha.
- **Idempotência:** `calculate_bl_local_charges` é idempotente por `calculation_key` (único por `bl_id` + chave); recálculo limpa e regrava preservando charges manuais.
- **Câmbio não converte charges.** BRL e USD são armazenados em paralelo no item conforme `currency`; não há conversão automática FX no cálculo. As cotações de [`src/hooks/useExchangeRates.ts`](../../src/hooks/useExchangeRates.ts) (PTAX via `olinda.bcb.gov.br`) servem apenas para exibição no header.

## Dependências

- **Tabelas Supabase:** `charge_tables`, `charge_table_items`, `charge_calculations`, `customer_rate_overrides`, `bls`, `granite_bls`. (`pricing_rule_versions` existe mas não é consultada aqui.)
- **RPCs:** `resolve_local_charge_table_id`, `calculate_bl_local_charges`, `list_bl_local_charge_lines`, `list_manual_charge_items_for_bl`, `add_manual_bl_charge`, `update_manual_bl_charge`, `delete_manual_bl_charge`, `mark_bl_charges_reviewed`, `mark_bl_ready_for_billing`, `list_customer_reconciliation_queue`, `approve_customer_reconciliation`, `reject_customer_reconciliation`.
- **Integrações externas:** Banco Central / `olinda.bcb.gov.br` (PTAX) — somente exibição.
- **Outros módulos:** [Faturamento](faturamento.md) (consome `ready_for_billing` e a fila de reconciliação), [Demurrage](demurrage.md) (módulo de cobrança irmão), [Regras de negócio](../operations/regras-de-negocio.md), [Glossário](../GLOSSARIO.md), [Arquitetura](../ARCHITECTURE.md).

## Notas e divergências

- **Granito é isolado.** `granite_bls` tem charges próprios e RPC separada (`mark_granite_bl_ready`); `listLocalChargeOperationalRows` carrega `bls` + `granite_bls` na mesma view operacional, mas não compartilham a RPC de cálculo.
- **IMO+OOG sem caminho automático.** Container marcado IMO e OOG ao mesmo tempo força `review_required` sem recálculo automático — exige ajuste ou isenção manual.
- **`pricing_rule_versions` ocioso.** Tabela de versionamento criada para auditoria de regras de preço, mas o módulo audita via `audit_logs` (`entity_type = 'charge_calculation'`).
- **Charges manuais pulam a revisão.** `add_manual_bl_charge` grava `status = reviewed` direto, fora do loop normal de revisão.
