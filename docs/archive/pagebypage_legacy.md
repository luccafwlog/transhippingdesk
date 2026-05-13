# Relatório do Sistema — Transhipping Desk

## Índice

1. [Painel (Dashboard)](#1-painel)
2. [Viagens](#2-viagens)
3. [Manifestos (CNTR)](#3-manifestos-cntr)
4. [B/L Detalhe](#4-bl-detalhe)
5. [Revisão](#5-revisão)
6. [Taxas Locais](#6-taxas-locais)
7. [Faturamento](#7-faturamento)
8. [Demurrage](#8-demurrage)
9. [Demurrage Invoices](#9-demurrage-invoices)
10. [Granito](#10-granito)
11. [Granite Rates](#11-granite-rates)
12. [Vazios Importação](#12-vazios-importação)
13. [Embarque Vazios](#13-embarque-vazios)
14. [Containers](#14-containers)
15. [Carga Solta](#15-carga-solta)
16. [Veículos](#16-veículos)
17. [Clientes](#17-clientes)
18. [Ficha do Cliente](#18-ficha-do-cliente)
19. [Reconciliação PIX](#19-reconciliação-pix)
20. [Alertas](#20-alertas)
21. [Admin — Usuários](#21-admin--usuários)
22. [Relatórios](#22-relatórios)
23. [Line Up TV (Display)](#23-line-up-tv-display)
24. [Login Interno](#24-login-interno)
25. [Portal Login](#25-portal-login)
26. [Portal Faturamento](#26-portal-faturamento)

---

## 1. Painel

**Arquivo:** `src/pages/Painel.tsx`

**Resumo:** Dashboard operacional e tela inicial. Exibe o Line Up TV (matriz viagem × POD) e 10 KPI cards com contagens e agregados financeiros do sistema. Auto-atualiza o Line Up a cada 90 segundos.

### Fontes de dados

| Dado | Tabela(s) | Observação |
|---|---|---|
| Total de B/Ls | `bls` | count com `head:true` |
| B/Ls em revisão pendente | `bls` | filtro `review_status='pending_review'` |
| Taxas com pendência de revisão | `bls` | filtro `charge_status='review_required'` |
| Prontos para faturar | `bls` | filtro `charge_status='ready_for_billing'` |
| Pendências financeiras | `bls` | filtro `financial_status='pending'` |
| Faturas abertas + valor | `invoices` | `status IN ('issued','overdue')`, até 500 linhas |
| Alertas abertos | `alerts` | `status != 'closed'`, count |
| B/Ls sem cliente | `bls` | `customer_id IS NULL`, count |
| Containers (distintos) | `bl_containers` | batches de 1000, deduplicação client-side por `normalizeContainerNumber` |
| Snapshot Line Up | `voyages`, `bls`, `bl_containers`, `vehicles`, `audit_logs` | `fetchLineUpSnapshot()` em `services/lineup.ts` |

### Botões e ações

| Botão | O que faz |
|---|---|
| **"Abrir tela TV"** | Abre `/line-up-tv/display` em nova aba. Sem gravação. |
| **"Atualizar"** | Chama `refetch()` no query `['lineup-tv-v3']` re-executando `fetchLineUpSnapshot()`. Somente leitura. |
| **Filtros de aba** ("Todas as escalas", "Escalas ativas", "Escalas concluídas") | Filtro client-side em `lineup.rows` por `voyageStatus`. Sem chamada ao BD. |
| **10 KPI cards** | Cada um é um `<Link>` para uma rota diferente (`/manifestos`, `/containers`, `/revisao`, `/faturamento`, `/taxas-locais`, `/alertas`). Sem gravação. |

---

## 2. Viagens

**Arquivo:** `src/pages/Viagens.tsx`

**Resumo:** Master de viagens. Cada card exibe o cabeçalho navio/viagem, métricas por módulo de carga (CNTR, Breakbulk, Granito, Vazios), tabela de datas POD e manifests por rota. Admins podem criar, editar e excluir viagens. Qualquer usuário autenticado pode editar ETD (por POL) e datas de agenda POD.

### Fontes de dados

| Dado | Hook | Tabelas |
|---|---|---|
| Todas as viagens com B/Ls, containers, etc. | `useVoyages()` | `voyages`, `vessels`, `carriers`, `ports`, `import_batches`, `granite_manifests`, `granite_bls`, `vazios_manifests`, `vazios_bookings`, `bls`, `bl_containers`, `bl_breakbulk_items` |
| Estatísticas de veículos por viagem | `useVoyageVehicleStats()` | `vehicles`, `bl_containers`, `bls` |
| Status de faturamento | `fetchVoyagesWithUnpaidBls()` | `bls` |
| Agendas POL (ETD) | `listVoyagePolSchedules()` | `audit_logs` (entity_type `voyage_pol_schedule`) |
| Agendas POD | `listVoyagePodSchedulesByVoyageIds()` | `audit_logs` (entity_type `voyage_pod_schedule`) |

> **Arquitetura do audit trail:** Dados de POD/POL (ETA, ETB, ATA, ATD, RTW, CE status, ESCALA linked, ETD) são armazenados como eventos insert-only em `audit_logs`, não como colunas em `voyages`. O estado atual é reconstruído no read tomando o valor mais recente por campo.

### Botões e ações

| Botão | Função | Efeito no BD |
|---|---|---|
| **"Nova Viagem"** (admin only) | Abre `VoyageCreateModal` | Sem gravação até salvar |
| **"Salvar" (modal criação)** | `createVoyage()` | INSERT `carriers` (upsert por SCAC), INSERT `vessels`, INSERT `voyages`; INSERT `audit_logs` para ETAs de POD |
| **"Editar"** (lápis, admin only) | Abre `VoyageCreateModal` em modo edição | Sem gravação até salvar |
| **"Salvar" (modal edição)** | `updateVoyage()` | UPDATE `voyages`; upsert `carriers`/`vessels`; INSERT `audit_logs` para POD alterados |
| **"Excluir"** (lixeira, admin only) | Abre modal de confirmação | Sem gravação |
| **"Excluir viagem" (confirmar)** | `deleteVoyage()` | Verifica contagens em `bls`, `import_batches`, `granite_manifests`, `vazios_manifests`; se todas zeradas: DELETE `voyages` |
| **Lápis na linha POD** | Abre `PodScheduleModal` | Sem gravação até salvar |
| **"Salvar datas" (PodScheduleModal)** | `saveVoyagePodSchedule()` | INSERT `audit_logs` apenas para campos alterados (entity_type `voyage_pod_schedule`) |
| **Lápis na linha do manifesto** | Abre `PolScheduleModal` | Sem gravação até salvar |
| **"Salvar ETD" (PolScheduleModal)** | `saveVoyagePolSchedule()` | INSERT `audit_logs` (entity_type `voyage_pol_schedule`) |
| **Cards de navegação** (Manifestos CNTR, BB, Granito, Vazios) | `navigate('/[rota]?voyage={id}')` | Nenhum |

---

## 3. Manifestos (CNTR)

**Arquivo:** `src/pages/Manifestos.tsx`

**Resumo:** Lista paginada e filtrável de todos os B/Ls de contêineres (`cargo_mode='container'`). KPI cards acima da tabela. Importação via planilha CNTR e via CE Mercante.

### Fontes de dados

| Dado | Hook | Tabelas |
|---|---|---|
| B/Ls paginados | `useBls(filters)` | `bls` + `customers`, `voyages`, `vessels`, `carriers`, `bl_containers`, `bl_breakbulk_items` |
| KPIs | `useBlSummary(filters)` | Mesmo select, count em JS |
| Opções de porto | `usePortOptions()` | `bls` (pol, pod), até 5000 linhas |
| Opções de viagem | `useVoyageOptions()` | `voyages` + `vessels` |
| Links de faturas | `useInvoiceLinks(blIdsOnPage)` | `invoice_bls` + `invoices` |

### Botões e ações

| Botão | O que faz |
|---|---|
| **"Exportar"** | Busca todos os B/Ls com filtros atuais (sem limite de página), gera XLSX via SheetJS (`exportManifestWorkbook`), download no browser. Sem escrita no BD. |
| **"Importar CE Mercante"** | Abre `CeMercanteImportModal` |
| **"Importar Manifesto CNTR"** | Abre `UploadManifestModal` |
| **Filtros** (texto, dropdowns, paginação) | Atualizam estado local, re-disparam `useBls` |
| **Link do B/L** | Navega para `/manifestos/{<bl.id>}` |

#### UploadManifestModal — importação CNTR

| Ação | Função | Efeito no BD |
|---|---|---|
| **Selecionar arquivo** | `parseManifestFile()` — client-side SheetJS | Nenhum |
| **"Criar viagem agora"** | `createVoyage()` | INSERT `voyages`, `vessels`, `carriers`; INSERT `audit_logs` para ETAs |
| **"Confirmar importação"** | `importManifest()` → RPC `import_manifest_transactional` | PL/pgSQL atômico: INSERT `import_batches`; UPSERT `bls`; DELETE + INSERT `bl_containers`; INSERT `import_errors` para erros de linha; INSERT `audit_logs` para ETD/POD linked |

---

## 4. B/L Detalhe

**Arquivo:** `src/pages/BlDetalhe.tsx`

**Resumo:** Hub de edição e auditoria por B/L. Suporta modos `container` e `carga_solta`. Organizado em cinco abas: Operacional, Carga, Cobranças, Financeiro, Histórico. Todas as edições são auditadas e exigem justificativa escrita.

### Fontes de dados

| Dado | Hook | Tabelas / RPC |
|---|---|---|
| Detalhe completo do B/L | `useBlDetail(blId)` | `bls` + `customers`, `voyages`, `vessels`, `carriers`, `bl_containers`, `bl_breakbulk_items`, `vehicles` |
| Links de faturas | `useInvoiceLinks([blId])` | `invoice_bls`, `invoices` |
| Logs de auditoria | `useAuditLogs('bl', blId)` | `audit_logs` (entity_type='bl'), até 200 linhas |
| Linhas de cobrança | `useBlLocalChargeLines(blId)` | RPC `list_bl_local_charge_lines(p_bl_id)` → `charge_calculations` |
| Itens de cobrança manual | `useManualChargeItemsForBl(blId)` | RPC `list_manual_charge_items_for_bl(p_bl_id)` → `charge_table_items`, `charge_tables`, `customer_rate_overrides` |

### Botões e ações

#### Aba Operacional

| Botão | Efeito no BD |
|---|---|
| **"Salvar alterações"** | RPC `save_bl_review`: UPDATE `bls` para campos alterados; INSERT `audit_logs` por campo; trava otimista em `updated_at` (conflito lança PT409) |

#### Aba Carga

| Botão | Efeito no BD |
|---|---|
| **Ícone salvar (data de devolução por container)** | UPDATE `bl_containers.return_date` via `updateContainerReturnDate()` |

#### Aba Cobranças — Other Charges

| Botão | Efeito no BD |
|---|---|
| **"Adicionar other charge"** | RPC `add_manual_bl_charge`: INSERT `charge_calculations` (source=manual); UPDATE `bls.charge_status`; INSERT `audit_logs` |
| **"Salvar edição"** | RPC `update_manual_bl_charge`: UPDATE `charge_calculations.quantity/notes`; INSERT `audit_logs` |
| **Lápis** | Client-side — popula formulário |
| **Lixeira** | RPC `delete_manual_bl_charge`: DELETE `charge_calculations`; UPDATE `bls.charge_status`; INSERT `audit_logs` |
| **"Marcar revisado"** | RPC `mark_bl_charges_reviewed`: UPDATE `bls.charge_status` → `reviewed`; UPDATE `charge_calculations`; INSERT `audit_logs` |
| **"Pronto para faturar"** | RPC `mark_bl_ready_for_billing` + (se cliente vinculado) `createInvoiceFromBls({issueNow:true})`: UPDATE `bls.charge_status` → `ready_for_billing`; INSERT `invoices`; INSERT `invoice_bls`; UPDATE `bls.financial_status` → `invoiced` |

---

## 5. Revisão

**Arquivo:** `src/pages/Revisao.tsx`

**Resumo:** Fila de revisão manual. Exibe B/Ls com `review_status='pending_review'` e `granite_bls` sem `client_id`. O modal de revisão permite editar campos do B/L, vincular ou criar cliente, e submeter. Após cada salvamento avança automaticamente para o próximo item.

### Fontes de dados

| Dado | Hook | Tabelas |
|---|---|---|
| Fila de revisão | `useReviewQueue()` | `bls` (review_status='pending_review') + `granite_bls` (client_id IS NULL) com joins |
| Busca de clientes (modal) | `useCustomerLookup(search)` | `customers`, OR-filtrado por nome/CNPJ, mín. 2 chars |

### Botões e ações

| Botão | Função | Efeito no BD |
|---|---|---|
| **Filtros de texto/tag** | `setSearchText` / `setReasonFilter` | Filtro client-side |
| **"Corrigir"** | `openItem(index)` | Abre modal |
| **"Abrir B/L"** | `navigate('/manifestos/{id}')` | Nenhum |
| **"Cadastrar cliente"** | `createCustomer()` | INSERT `customers` |
| **"Marcar como revisado"** (B/L) | `saveBlReview()` | RPC `save_bl_review`: UPDATE `bls` + INSERT `audit_logs`; trava otimista |
| **"Marcar como revisado"** (Granite) | `saveGraniteBlReview()` | UPDATE `granite_bls.client_id`; INSERT `audit_logs` |

---

## 6. Taxas Locais

**Arquivo:** `src/pages/TaxasLocais.tsx`

**Resumo:** Central da engine de cobranças locais. Três abas controladas por permissão: **Tabelas** (`charge_tables`): CRUD de tabelas e itens de cobrança; **Overrides** (`charge_overrides`): CRUD de overrides por cliente; **Operação** (todos): batch de B/Ls com cálculo, revisão e faturamento automático.

### Fontes de dados

| Dado | Hook / RPC | Tabelas |
|---|---|---|
| Tabelas e itens | `useLocalChargeTables()` | `charge_tables` + `charge_table_items` |
| Overrides de clientes | `useCustomerRateOverrides()` | `customer_rate_overrides` + `customers` + `charge_table_items` |
| B/Ls operacionais | `useLocalChargeOperations()` | `bls` + `voyages` + `vessels` + `customers` + `charge_calculations` + `audit_logs` |
| Runs de faturamento | `useBillingRuns()` | RPC `list_billing_runs(p_limit)` |
| Fila de reconciliação | `useCustomerReconciliationQueue()` | RPC `list_customer_reconciliation_queue` |

### Botões e ações — Aba Tabelas

| Botão | Efeito no BD |
|---|---|
| **"Criar/Salvar tabela"** | INSERT ou UPDATE `charge_tables` |
| **Ativar/desativar tabela** | UPDATE `charge_tables.active` |
| **"Criar/Salvar item"** | INSERT ou UPDATE `charge_table_items` |
| **Lixeira (item)** | DELETE `charge_table_items` |

### Botões e ações — Aba Overrides

| Botão | Efeito no BD |
|---|---|
| **"Criar/Salvar override"** | INSERT ou UPDATE `customer_rate_overrides` |
| **Lixeira (override)** | DELETE `customer_rate_overrides` |

### Botões e ações — Aba Operação

| Botão | Função | Efeito no BD |
|---|---|---|
| **"Aprovar"** (fila reconciliação) | RPC `approve_customer_reconciliation` | UPDATE `customer_reconciliation_queue` → `approved`; UPDATE `bls.customer_id`; INSERT `audit_logs` |
| **"Rejeitar"** (fila reconciliação) | RPC `reject_customer_reconciliation` | UPDATE `customer_reconciliation_queue` → `rejected` |
| **"Calcular selecionados"** | RPC `calculate_bl_local_charges` por B/L | DELETE + INSERT `charge_calculations`; UPDATE `bls.charge_status`; INSERT `audit_logs` |
| **"Recalcular selecionados"** | Mesmo RPC, `recalculate:true` | Força recalculation mesmo já calculado |
| **"Marcar revisados"** | RPC `mark_bl_charges_reviewed` por B/L | UPDATE `bls.charge_status` → `reviewed`; UPDATE `charge_calculations`; INSERT `audit_logs` |
| **"Marcar pronto faturar"** | RPC `mark_bl_ready_for_billing` + `createInvoiceFromBls({issueNow:true})` por B/L com cliente | UPDATE `bls.charge_status` → `ready_for_billing`; INSERT `invoices`; INSERT `invoice_bls` |
| **"Exportar visão"** | `exportLocalChargeOperationsWorkbook()` | Somente leitura; download XLSX |

---

## 7. Faturamento

**Arquivo:** `src/pages/Faturamento.tsx`

**Resumo:** Central de gestão de faturas (taxas locais e Granito). Criação unitária e consolidada, histórico paginado, detalhes, registro de pagamentos, cancelamento e impressão de PDF.

### Fontes de dados

| Dado | Hook | Tabelas / RPC |
|---|---|---|
| Lista de faturas (paginada) | `useInvoices(filters)` | `invoices` + `invoice_bls` + `customers` |
| Detalhe da fatura | `useInvoiceDetail(id)` | RPC `list_invoice_details(p_invoice_id)` |
| B/Ls prontos (locais) | `useBillingReadyBls()` | `bls` (charge_status=ready_for_billing, financial_status=pending) + `customers`, `voyages`, `vessels` |
| B/Ls prontos (Granite) | `useBillingReadyGraniteBls()` | `granite_bls` (charge_status=ready_for_billing) + `customers`, `granite_manifests` |
| Clientes (filtros e seleção) | `useBillingCustomers(search)` | `customers`, limite 300 |
| Alertas financeiros | `useQuery(['financial-alerts'])` | `financial_alerts` |

### Botões e ações

#### Painel de alertas

| Botão | Efeito no BD |
|---|---|
| **"Reconhecer"** | UPDATE `alerts.status` → `'acknowledged'` |
| **"Fechar"** | UPDATE `alerts.status` → `'closed'`, `closed_at=now()` |

#### Lista de faturas

| Botão | O que faz |
|---|---|
| **"Detalhes"** (por linha) | Seta `selectedInvoiceId`, dispara `useInvoiceDetail` (RPC), abre modal |
| **"Anterior" / "Próxima"** | Atualiza `filters.page`, re-query `useInvoices` |
| **Filtros** | `updateFilter(key, value)` → re-query |

#### Modal "Nova Invoice"

| Botão | Efeito no BD |
|---|---|
| **Checkboxes de B/L** | Seleção client-side |
| **"Emitir invoice"** (B/Ls Granite) | RPC `create_invoice_from_granite_bls`: INSERT `invoices`, INSERT `invoice_bls`, UPDATE `granite_bls` |
| **"Emitir invoice"** (B/Ls locais) | RPC `create_invoice_from_bls(p_issue_now=true)`: INSERT `invoices`, INSERT `invoice_bls`, UPDATE `bls.financial_status` |
| **"Cancelar"** | Fecha modal, sem gravação |

#### Modal de detalhe da fatura

| Botão | Função | Efeito no BD |
|---|---|---|
| **"Imprimir PDF"** | `window.print()` | Nenhum |
| **"Registrar pagamento"** | RPC `register_invoice_payment` | INSERT `invoice_payments`; UPDATE `invoices.total_paid_brl` e `status` |
| **"Cancelar invoice"** (disabled se há pagamentos) | RPC `cancel_invoice` | UPDATE `invoices.status` → `'cancelled'` |

---

## 8. Demurrage

**Arquivo:** `src/pages/Demurrage.tsx`

**Resumo:** Gestão de sobrestadia de containers. Quatro abas: **Containers** (visão ao vivo com cálculo em tempo real), **Rascunhos**, **Emitidas**, **Pagas**. Integra com a API BCB PTAX para ROE automático. Faturas geradas por importação de datas são emitidas automaticamente com ROE da BCB — rascunhos aparecem apenas quando a BCB está offline.

### Fontes de dados

| Dado | Query key | Tabelas / Fonte |
|---|---|---|
| Containers (aba) | `['demurrage-containers']` | `bl_containers` + `bls` + `customers`, `voyages`, `vessels` |
| KPI bar | `['demurrage-kpis']` | `bl_containers` (count overdue), `demurrage_invoices` (somas por status) |
| Faturas (por aba) | `['demurrage-invoices', status]` | `demurrage_invoices` + `customers`, `bls` |
| Detalhe da fatura (impressão) | `['demurrage-invoice-detail', id]` | `demurrage_invoices` + `demurrage_invoice_items` |
| ROE (no momento da mutação) | — | API BCB PTAX (`<olinda.bcb.gov.br>`) + cache localStorage |

> **Mecânica do ROE:** `fetchROE()` chama o PTAX do BCB, aplica spread de 1.065, armazena em `localStorage` como `demurrage_roe_cache`. Se offline, usa cache. `frozen_roe` e `frozen_total_brl` são gravados na emissão e nunca alterados.

> O `calculateDemurrage()` é **puro client-side** — recebe tipo de container, datas e overrides do B/L, retorna totais em USD usando `RATE_GROUPS` embutida no serviço. Sem chamada ao BD.

### Botões e ações

| Botão | Função | Efeito no BD |
|---|---|---|
| **"Importar Datas"** | Abre `ContainerDatesImportModal` | Ver abaixo |
| **Abas** | Alterna queries ativas | Nenhum |
| **"Gerar Invoice"** (aba Containers, apenas quando `hasOverdue=true`) | `createInvoiceForBL(blId)` | Lê `bls` + `bl_containers` (overdue); INSERT `demurrage_invoices`; INSERT `demurrage_invoice_items` |
| **"Emitir"** (rascunho) | `fetchROE()` + `issueInvoice(id, roe)` | UPDATE `demurrage_invoices`: `status='issued'`, `billed_at`, `frozen_roe`, `frozen_total_brl`, `pix_payload` |
| **"Cancelar"** (rascunho) | `cancelDemurrageInvoice(id)` | UPDATE `demurrage_invoices.status` → `'cancelled'` |
| **"Registrar Pgto"** (emitida) | Abre modal de pagamento | Sem gravação |
| **"Confirmar"** (modal pagamento) | `fetchROE()` + `markInvoicePaid(id, date, roe)` | UPDATE `demurrage_invoices`: `status='paid'`, `paid_at`, `frozen_roe`, `frozen_total_brl` |
| **"Desemitir"** (emitida) | `unissueInvoice(id)` | UPDATE `demurrage_invoices`: `status='draft'`, limpa campos frozen |
| **"Fatura"** (emitida) | Abre modal de impressão com `docType='invoice'` | Nenhum |
| **"Recibo"** / **"Fatura"** (paga) | Abre modal de impressão | Nenhum |
| **"Desmarcar"** (paga) | `unmarkInvoicePaid(id)` | UPDATE `demurrage_invoices.status` → `'issued'`, limpa `paid_at` |
| **"Imprimir"** | `window.print()` | Nenhum |

#### ContainerDatesImportModal

| Ação | Efeito no BD |
|---|---|
| Selecionar arquivo | Parse client-side SheetJS; sem escrita |
| **"Importar"** | UPDATE `bl_containers` (discharge_date, return_date, demurrage_status); se todos containers do B/L retornados: `createInvoiceForReturnedBL()` → INSERT `demurrage_invoices` + `demurrage_invoice_items`; então `fetchROE()` + `issueInvoice()` — fatura emitida automaticamente (se BCB offline: permanece como draft) |

---

## 9. Demurrage Invoices

**Arquivo:** `src/pages/DemurrageInvoices.tsx`

**Resumo:** Visão dedicada de faturas de demurrage, funcionalmente idêntica às abas de faturas dentro do Demurrage. Opera como rota independente. Mesmas queries (`['demurrage-invoices', status]`), mesmas mutações, mesmos botões — sem a aba de Containers e sem KPI bar.

---

## 10. Granito

**Arquivo:** `src/pages/Granite.tsx`

**Resumo:** Gestão de B/Ls do COSCO Granito (Relatório de Cargas). Dois fluxos principais: (1) importação de planilha Excel com reconciliação de CNPJ contra `customers`; (2) cálculo de taxas por B/L com auto-emissão de fatura quando cliente já está vinculado.

### Fontes de dados

| Dado | Query key | Tabelas |
|---|---|---|
| Lista de B/Ls Granite | `['granite-bls', filters]` | `granite_bls` + `granite_manifests`, `voyages`, `vessels`, `customers` |
| Opções de viagem | `['voyage-options']` | `voyages` + `vessels` |
| Mapas de clientes (override CNPJ) | — (imperativo) | `customers` |

### Botões e ações

#### Tabela principal

| Botão | Função | Efeito no BD |
|---|---|---|
| **"Calcular taxas"** (com cliente vinculado) | `calculateGraniteBlCharges()` + `createInvoiceFromGraniteBls({issueNow:true})` | DELETE + INSERT `granite_bl_charges`; UPDATE `granite_bls.charge_status='calculated'`; INSERT `invoices` + `invoice_bls` (fatura emitida automaticamente) |
| **"Calcular taxas"** (sem cliente) | `calculateGraniteBlCharges()` | Mesmo que acima, sem fatura; abre modal de preview |
| **"Fechar"** (modal de preview) | `setChargeBlId(null)` | Nenhum |
| **Filtros / paginação** | `updateFilter()` | Re-query `listGraniteBls` |

#### Modal de importação COSCO

| Ação | Efeito no BD |
|---|---|
| Selecionar arquivo | Parse client-side SheetJS; nenhum |
| Override de CNPJ inline | `loadCustomerMaps()` + match client-side; nenhum até confirmar |
| **"Confirmar importação"** | `importGraniteManifest()`: INSERT `granite_manifests`; UPSERT `granite_bls` |

---

## 11. Granite Rates

**Arquivo:** `src/pages/GraniteRates.tsx`

**Resumo:** CRUD de tarifas de cobrança Granito (`granite_rates`). Tipos: `per_kg`, `per_ton`, `per_bl` (fixo), `fixed`. Com janelas de vigência e toggle ativo/inativo. Acesso de escrita restrito a admins.

**Cálculo de quantidade por tipo:**
- `per_kg`: quantidade = peso bruto em kg
- `per_ton`: quantidade = peso bruto ÷ 1000
- `per_bl` / `fixed`: quantidade = 1

### Botões e ações

| Botão | Função | Efeito no BD |
|---|---|---|
| **"Nova taxa"** (admin only) | Abre modal com formulário vazio | Nenhum |
| **Badge ativo/inativo** (admin only) | `upsertGraniteRate({...rate, active: !rate.active})` | UPDATE `granite_rates.active` |
| **"Editar"** (admin only) | Popula formulário | Nenhum |
| **Lixeira** (admin only) | Confirma + `deleteGraniteRate(id)` | DELETE `granite_rates` |
| **"Salvar"** (modal) | `upsertGraniteRate(form)` | INSERT (novo) ou UPDATE (existente) `granite_rates` |

---

## 12. Vazios Importação

**Arquivo:** `src/pages/VaziosImportacao.tsx`

**Resumo:** Containers vazios de importação (chegando ao porto). Tabela paginada e filtrável organizada por lotes de manifesto.

### Fontes de dados

| Dado | Query key | Tabelas |
|---|---|---|
| Containers | `['vazios-importacao-containers', filters]` | `vazios_importacao_containers` + `vazios_importacao_manifests` |
| Manifestos (filtro) | `['vazios-importacao-manifests']` | `vazios_importacao_manifests` |
| Opções de viagem | `['voyage-options']` | `voyages` + `vessels` |

### Botões e ações

| Botão | O que faz |
|---|---|
| **"Importar Planilha"** | Abre modal de upload |
| **Seleção de arquivo** | `parseVaziosImportacaoFile()` — SheetJS client-side; nenhum BD |
| **"Confirmar importação"** | `importVaziosImportacaoManifest()`: INSERT `vazios_importacao_manifests`; UPSERT `vazios_importacao_containers` (conflict: manifest_id + container_number) |
| **"Cancelar"** | Reset do estado do modal |
| **Filtros / paginação** | Re-query |

---

## 13. Embarque Vazios

**Arquivo:** `src/pages/EmbarqueVazios.tsx`

**Resumo:** Containers vazios de exportação (partindo do porto), identificados por booking. Tabela paginada e filtrável por viagem e manifesto.

### Fontes de dados

| Dado | Query key | Tabelas |
|---|---|---|
| Bookings | `['vazios-bookings', filters]` | `vazios_bookings` + `vazios_manifests` → `voyages` → `vessels` |
| Opções de viagem | `['voyage-options']` | `voyages` + `vessels` |

### Botões e ações

| Botão | O que faz |
|---|---|
| **"Baixar template"** | Download estático `/templates/vazios-modelo.xlsx` |
| **"Importar Planilha"** | Abre modal |
| **Seleção de arquivo** | `parseVaziosManifestFile()` — SheetJS; nenhum BD |
| **"Confirmar importação"** | `importVaziosManifest()`: INSERT `vazios_manifests`; UPSERT `vazios_bookings` (conflict: manifest_id + booking_number) |

> Lê `?voyage` da query string para pré-selecionar o filtro de viagem.

---

## 14. Containers

**Arquivo:** `src/pages/Containers.tsx`

**Resumo:** Visão consolidada de todos os containers importados via manifesto. Exportação XLSX, importação de flags IMO/OOG, e acesso ao modal de importação de datas de demurrage.

### Fontes de dados

| Dado | Query key | Tabelas |
|---|---|---|
| Containers (paginados) | `['containers', filters]` | `bls` + `bl_containers` + `customers` + `voyages` + `vessels` + `carriers` |
| Opções de viagem | `['voyage-options']` | `voyages` + `vessels` |
| Opções de porto | `['port-options']` | `bls` (pol, pod) |

### Botões e ações

| Botão | O que faz |
|---|---|
| **"Importar Datas Demurrage"** | Abre `ContainerDatesImportModal` |
| **"Importar IMO/OOG"** | Abre modal de importação de flags |
| **"Exportar Containers"** | Busca todos matching, gera XLSX via `exportContainerWorkbook()`. Sem escrita. |
| **Seleção de arquivo (IMO/OOG)** | `parseContainerFlagsImportFile()` — SheetJS; nenhum BD |
| **"Atualizar containers"** | `importContainerFlagsRows()`: UPDATE `bl_containers` (is_imo, imo_class, un_number, imo_value, is_oog) por bl_id + container_number |
| **"Abrir B/L"** | Navega para `/manifestos/{<bl.id>}` |

---

## 15. Carga Solta

**Arquivo:** `src/pages/CargaSolta.tsx`

**Resumo:** Lista de B/Ls break-bulk (`cargo_mode='carga_solta'`). KPIs de máquinas, pacotes, peso e CBM. Exportação XLSX, importação CE Mercante e importação de manifesto BB.

### Fontes de dados

Idêntico ao Manifestos CNTR, com filtro `cargoMode:'carga_solta'` e coluna `bl_breakbulk_items`.

### Botões e ações

| Botão | O que faz |
|---|---|
| **"Exportar"** | Busca todos os B/Ls matching, gera XLSX via `exportManifestWorkbook()` |
| **"Importar CE Mercante"** | Abre `CeMercanteImportModal` |
| **"Importar Manifesto BB"** | Abre modal de importação |
| **Seleção de arquivo (BB)** | `parseBreakbulkManifestFile()` — SheetJS; nenhum BD |
| **"Confirmar importação"** | `importBreakbulkManifest()`: INSERT/UPSERT `bls` (cargo_mode='carga_solta'); INSERT `import_batches` |
| **"Abrir B/L"** | Navega para `/manifestos/{<bl.id>}` |

---

## 16. Veículos

**Arquivo:** `src/pages/Veiculos.tsx`

**Resumo:** Gestão de veículos VIN por viagem. Cards de breakdown (por marca, por tipo de container). Importação XLSX com relatório de erros por linha. Filtro client-side (dados pré-carregados por viagem).

### Fontes de dados

| Dado | Query key | Tabelas |
|---|---|---|
| Opções de navio/viagem | `['vehicle-voyage-options']` | `voyages` + `vessels` |
| Veículos da viagem | `['vehicles', voyageId]` | `vehicles` + `bl_containers` + `bls` → `voyages`, `vessels` |

### Botões e ações

| Botão | O que faz |
|---|---|
| **Select Navio / Viagem** | Filtra dropdown e habilita query `useVehicles` |
| **"Baixar modelo"** | Download estático `/templates/veiculos-modelo.xlsx` |
| **Seleção de arquivo** | `parseVehicleImportFile()` — SheetJS; nenhum BD |
| **"Confirmar importação"** | `importVehicleRows()`: valida container e BL no BD; UPSERT `vehicles` (conflict: voyage_id + chassis); retorna relatório de erros por linha |
| **Filtros** (chassis, container, BL) | Filtro client-side no array pré-carregado — sem novo query |

---

## 17. Clientes

**Arquivo:** `src/pages/Clientes.tsx`

**Resumo:** Cadastro mestre de clientes. KPIs por cliente (B/Ls vinculados, cobranças pendentes). Cadastro individual e importação em massa por XLSX/CSV. Clientes precisam existir aqui antes da importação de manifestos para que o vínculo ocorra automaticamente por CNPJ/CPF.

### Fontes de dados

| Dado | Query key | Tabelas |
|---|---|---|
| Lista de clientes | `['customers', filters]` | `customers` + `bls(id, charge_status)` + `customer_contacts(id)` |

### Botões e ações

| Botão | O que faz |
|---|---|
| **"Importar base"** | Abre modal de importação em massa |
| **"Novo Cliente"** | Abre modal de cadastro individual |
| **Seleção de arquivo (importação)** | `parseCustomerBaseFile()` — SheetJS; nenhum BD |
| **"Importar base" (confirmar)** | `importCustomerBaseRows()`: UPSERT `customers`; INSERT `customer_contacts` novos; UPDATE `bls.customer_id` para B/Ls com CNPJ/CPF matching |
| **"Cadastrar cliente" (modal individual)** | `createCustomer()`: INSERT `customers`; INSERT `customer_contacts`; navega para `/clientes/{cnpj_cpf}` |
| **"Abrir ficha"** | Navega para `/clientes/{cnpj_cpf}` |
| **"Faturamento"** | Navega para `/faturamento?customer={id}` |

---

## 18. Ficha do Cliente

**Arquivo:** `src/pages/ClienteFicha.tsx`

**Resumo:** Detalhe individual do cliente. Cadastro, regras comerciais, contatos, histórico de B/Ls, histórico de faturas, e provisionamento/gestão de acesso ao portal do cliente. Todas as edições são auditadas em `audit_logs` com justificativa escrita.

### Fontes de dados

| Dado | Query key | Tabelas / RPC |
|---|---|---|
| Detalhe do cliente | `['customer-detail', cnpj]` | `customers` + `customer_contacts` + `bls` + `invoices` |
| Conta do portal | `['customer-portal-account', id]` | RPC `get_customer_portal_account(p_customer_id)` |

### Botões e ações

| Botão | Função | Efeito no BD |
|---|---|---|
| **"Salvar cadastro"** | `updateCustomerWithAudit()` | UPDATE `customers` para campos alterados; INSERT `audit_logs` por campo (com justificativa) |
| **"Salvar regras comerciais"** | `updateCustomerWithAudit()` | Mesmo mecanismo; campos: `payment_terms_days`, `discount_pct`, `commercial_notes` |
| **"Salvar contato"** | `upsertCustomerContact()` | UPDATE ou INSERT `customer_contacts` |
| **Lixeira (contato)** | `deleteCustomerContact()` | DELETE `customer_contacts` |
| **"Criar acesso portal" / "Salvar e resetar senha"** (admin only) | `upsertCustomerPortalAccount()` | RPC `upsert_customer_portal_account` |
| **"Desativar / Ativar portal"** (admin only) | `setCustomerPortalAccountActive()` | RPC `set_customer_portal_account_active` |
| **Links de B/L / Fatura** | `<Link>` | Navega para `/manifestos/{id}` ou `/faturamento` |

---

## 19. Reconciliação PIX

**Arquivo:** `src/pages/Reconciliacao.tsx`

**Resumo:** Conciliação de pagamentos PIX. O usuário sobe um extrato bancário (Itaú "QR Codes recebidos" XLSX). O sistema casa transações com faturas abertas de taxas locais e demurrage por TXID ou CNPJ + valor. Matches não-ambíguos são confirmados em lote.

### Fontes de dados (imperativo — sem React Query)

O matching lê:
- `invoices` (`status IN ('issued','overdue')`) — por TXID e CNPJ
- `demurrage_invoices` (`status='issued'`) — por TXID e CNPJ

### Botões e ações

| Botão | O que faz |
|---|---|
| **Drag-and-drop / seleção de arquivo** | `parsePixExtract()` — parse XLSX; `matchUnifiedPixTransactions()` — queries `invoices` + `demurrage_invoices`, retorna `UnifiedPixMatch[]` com flag `ambiguous`; sem escrita |
| **"Confirmar N pagamento(s)"** | Para cada match não-ambíguo: `source='local'` → `registerInvoicePayment()` (INSERT `invoice_payments`, UPDATE `invoices`) + UPDATE `invoices.pix_txid, conciliated_by_extract=true`; `source='demurrage'` → UPDATE `demurrage_invoices` (`status='paid'`, `paid_at`, `pix_txid`, `conciliated_by_extract=true`) |
| **"Limpar"** | `setMatches(null)` — sem gravação |

---

## 20. Alertas

**Arquivo:** `src/pages/Alertas.tsx`

**Resumo:** Dashboard de alertas operacionais. Tabela com filtro por status. Os alertas são gerados automaticamente pelo sistema.

### Fontes de dados

| Dado | Query key | Tabela |
|---|---|---|
| Lista de alertas | `['alerts', statusFilter]` | `alerts` (exceto `status='closed'`; limite 200) |

### Botões e ações

| Botão | Efeito no BD |
|---|---|
| **Abas de status** | Filtro de query; re-fetch |
| **"Reconhecer"** (alertas `open`) | UPDATE `alerts.status` → `'acknowledged'` |
| **"Fechar"** | UPDATE `alerts.status` → `'closed'`, `closed_at=now()` |
| **"Ver Fatura"** (tipo `portal_invoice_created`) | Navega para `/faturamento?invoice_id={entity_id}` |

---

## 21. Admin — Usuários

**Arquivo:** `src/pages/AdminUsuarios.tsx`

**Resumo:** Painel de administração com três abas: (1) Usuários — perfis, roles e toggle ativo/inativo; (2) Log de Ações — últimas 100 entradas de `audit_logs`; (3) Métricas — timestamps da última alteração de viagem, reconciliação PIX e criação de fatura.

### Fontes de dados

| Dado | Query key | Tabela |
|---|---|---|
| Usuários | `['admin-users']` | `user_profiles` |
| Log de ações (lazy, aba logs) | `['admin-audit-logs']` | `audit_logs` (últimas 100) + `user_profiles` (nome) |
| Métricas (lazy, aba métricas) | `['admin-metrics']` | `voyages`, `audit_logs` (pix_reconciliation), `invoices` — um registro mais recente de cada |

### Botões e ações

| Botão | Efeito no BD |
|---|---|
| **Select de role** (por usuário) | UPDATE `user_profiles.role` |
| **"Desativar" / "Ativar"** (por usuário) | UPDATE `user_profiles.active` |

---

## 22. Relatórios

**Arquivo:** `src/pages/Relatorios.tsx`

**Resumo:** Módulo de relatórios com três sub-abas: Operacional, Financeiro, Por Cliente. Exportação XLSX. Limite de 2.000 linhas por query. Acesso a dados financeiros depende de RLS — não-admins recebem `accessDenied: true` graciosamente.

### Fontes de dados

| Sub-aba | Query key | Tabelas |
|---|---|---|
| Operacional | `['report-operational', filters]` | `bls` + `customers` + `voyages` + `vessels` + `carriers` + `bl_containers` |
| Financeiro | `['report-financial', filters]` | `invoices` + `customers` |
| Por Cliente | `['report-customers', filters]` | `bls` + `customers` + `invoices` |

### Botões e ações

| Botão | O que faz |
|---|---|
| **Abas** | Alterna sub-componente ativo |
| **"Exportar xlsx"** (cada aba) | Gera XLSX via SheetJS dos resultados atuais; download no browser. Sem escrita no BD. |
| **Filtros** | Atualizam estado, re-disparam query da aba ativa |

---

## 23. Line Up TV (Display)

**Arquivo:** `src/pages/LineUpTVDisplay.tsx`

**Resumo:** Painel de TV para a sala de operações. Exibe até 8 linhas por vez, auto-scroll a cada 6 segundos, polling a cada 30 segundos. Tenta entrar em fullscreen no mount. **Somente leitura — nenhuma ação do usuário modifica dados.**

### Fontes de dados

| Query key | Função | Tabelas |
|---|---|---|
| `['lineup-tv-display-v2']` | `fetchLineUpSnapshot()` | `voyages`, `bls`, `bl_containers`, `vehicles`, `vazios_importacao_manifests`, `vazios_importacao_containers`, `audit_logs` |

**Colunas:** Vessel, Voy, POD, ETA, ETB, VIN, CAR, CG, Total containers, MTY, RTW, BB, CEs, Linked.

> `src/pages/LineUpTV.tsx` é apenas um redirect para `/painel`.

---

## 24. Login Interno

**Arquivo:** `src/pages/Login.tsx`

**Resumo:** Autenticação da equipe interna via email/senha (Supabase Auth). Sem auto-registro — usuários são provisionados por admins. Redireciona para `/painel` se já autenticado.

| Botão | Efeito |
|---|---|
| **"Entrar"** | `supabase.auth.signInWithPassword()` → cria sessão; carrega `user_profiles` verificando `active=true`; navega para `/painel` |

---

## 25. Portal Login

**Arquivo:** `src/pages/PortalLogin.tsx`

**Resumo:** Login externo para clientes em `/portal/login`. Autenticação por CNPJ/CPF + senha (sistema próprio, não Supabase Auth). Token persistido em `localStorage`. Trata explicitamente o rate-limit `P0429`.

| Botão | Efeito |
|---|---|
| **"Entrar no portal"** | RPC `portal_login(p_cnpj_cpf, p_password)` → valida credenciais; armazena token em localStorage; chama RPC `portal_get_session_overview`; navega para `/portal/billing` |

---

## 26. Portal Faturamento

**Arquivo:** `src/pages/PortalBilling.tsx`

**Resumo:** Portal externo do cliente em `/portal/billing`. B/Ls prontos para faturar, emissão de faturas consolidadas, histórico de faturas (locais e demurrage) com QR Code PIX inline, e download de PDF. Todo acesso via RPCs que validam o token de sessão.

### Fontes de dados (todos via token de sessão)

| Hook | RPC | Descrição |
|---|---|---|
| `usePortalPendingBls` | `portal_list_pending_bls` | B/Ls com `charge_status='ready_for_billing'` do cliente |
| `usePortalInvoices` | `portal_list_invoices` | Faturas de taxas locais do cliente |
| `usePortalInvoiceDetail` | `portal_invoice_details` | Fatura com B/Ls, itens e pagamentos |
| `usePortalDemurrageInvoices` | `portal_list_demurrage_invoices` | Faturas de demurrage do cliente |
| `usePortalDemurrageInvoiceDetail` | `portal_get_demurrage_invoice_detail` | Detalhe com itens por container |

### Botões e ações

| Botão | O que faz |
|---|---|
| **"Sair"** | RPC `portal_logout`; limpa localStorage; reseta estado |
| **Checkboxes de B/L** | Seleção client-side |
| **"Consolidar e emitir"** | RPC `portal_create_consolidation(token, bl_ids, due_date, notes)`: INSERT `invoices` + `invoice_bls`; auto-abre modal de detalhe |
| **Abas** "Taxas Locais" / "Demurrage" | Alterna tabela exibida |
| **"Detalhes"** (fatura local) | Dispara `usePortalInvoiceDetail`; abre modal |
| **"Baixar PDF"** | `downloadInvoicePdf()` — gera PDF client-side; download no browser. Sem escrita. |
| **"Detalhes"** (fatura demurrage) | Dispara `usePortalDemurrageInvoiceDetail`; abre modal com QR Code PIX inline |

---

## Referência rápida — RPCs do Supabase

| RPC | Chamado por |
|---|---|
| `import_manifest_transactional` | Manifestos, Carga Solta |
| `save_bl_review` | B/L Detalhe, Revisão |
| `calculate_bl_local_charges` | Taxas Locais |
| `add_manual_bl_charge` | B/L Detalhe |
| `update_manual_bl_charge` | B/L Detalhe |
| `delete_manual_bl_charge` | B/L Detalhe |
| `mark_bl_charges_reviewed` | B/L Detalhe, Taxas Locais |
| `mark_bl_ready_for_billing` | B/L Detalhe, Taxas Locais |
| `list_bl_local_charge_lines` | B/L Detalhe |
| `list_manual_charge_items_for_bl` | B/L Detalhe |
| `create_invoice_from_bls` | Faturamento, B/L Detalhe, Taxas Locais |
| `create_invoice_from_granite_bls` | Faturamento, Granito |
| `register_invoice_payment` | Faturamento, Reconciliação |
| `cancel_invoice` | Faturamento |
| `list_invoice_details` | Faturamento |
| `list_billing_runs` | Taxas Locais |
| `get_billing_run_details` | Taxas Locais |
| `list_customer_reconciliation_queue` | Taxas Locais |
| `approve_customer_reconciliation` | Taxas Locais |
| `reject_customer_reconciliation` | Taxas Locais |
| `get_customer_portal_account` | Ficha do Cliente |
| `upsert_customer_portal_account` | Ficha do Cliente |
| `set_customer_portal_account_active` | Ficha do Cliente |
| `portal_login` | Portal Login |
| `portal_logout` | Portal Faturamento |
| `portal_get_session_overview` | Portal Login, Portal Faturamento |
| `portal_list_pending_bls` | Portal Faturamento |
| `portal_list_invoices` | Portal Faturamento |
| `portal_invoice_details` | Portal Faturamento |
| `portal_list_demurrage_invoices` | Portal Faturamento |
| `portal_get_demurrage_invoice_detail` | Portal Faturamento |
| `portal_create_consolidation` | Portal Faturamento |

---

## Modelo de permissões

| Role | Permissões |
|---|---|
| `administrativo` | Todas |
| `financeiro` | `charge_tables`, `charge_overrides`, `demurrage_edit`, `faturamento_edit`, `reconciliacao_edit` |
| `operacoes` | `voyages_edit`, `manifests_upload` |
| `documentacao` | `voyages_edit`, `manifests_upload`, `demurrage_edit`, `faturamento_edit`, `reconciliacao_edit` |
