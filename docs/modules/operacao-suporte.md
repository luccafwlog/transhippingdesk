# Operação e Suporte
> **Status:** ativo · **Atualizado:** 2026-06-18

Documentação compacta dos módulos operacionais e de suporte menores: **Painel**, **Alertas**, **Relatórios**, **Line-Up TV**, **Admin Usuários** e **Revisão**. Cada submódulo segue a estrutura: propósito · arquivos · regras · dependências. Termos em [Glossário](../GLOSSARIO.md); regras transversais em [regras-de-negócio](../operations/regras-de-negocio.md); segurança em [segurança](../operations/seguranca.md); visão geral em [ARCHITECTURE](../ARCHITECTURE.md).

## Painel
**Propósito** — Dashboard operacional em `/painel`: KPIs, snapshot de line-up e visão de status das viagens (rota raiz redireciona para `/painel`).

**Arquivos**
- `src/pages/Painel.tsx`
- `src/services/lineup.ts` (`fetchLineUpSnapshot`)
- `src/components/lineup/LineUpTable.tsx`
- `src/hooks/useOperationalCounts.ts`

**Regras** — Line-up filtra por status da viagem (`active|completed|all`); POD nulo vira `'-'`; MTY (Vazios Importação) creditado só na primeira rota de cada viagem; containers deduplicados por `container_number`; status de CEs computado como `approved|partial|missing`; indicador de stale após 10 min sem refresh. `useOperationalCounts` retorna `{ pendingReview, chargeReviewRequired, readyForBilling, openAlerts, blsWithoutCustomer }`.

**Dependências** — Tabelas: `voyages`, `bls`, `bl_containers`, `vehicles`, `charge_tables`, `vazios_importacao_manifests`, `vazios_importacao_containers`, `audit_logs`, `alerts`, `invoices`. RPC: `count_distinct_containers`. Cache keys: `['dashboard']`, `['lineup-tv-v3']`, `['op-count', ...]`. Alimenta [Line-Up TV](#line-up-tv) e [Revisão](#revisão).

## Alertas
**Propósito** — Fila de alertas operacionais em `/alertas` (faturas vencidas, eventos de portal, demurrage, billing) com fluxo manual de acknowledge/close.

**Arquivos**
- `src/pages/Alertas.tsx`
- `src/services/alerts.ts`
- `src/hooks/useOperationalAlerts.ts`

**Regras** — Status `open → acknowledged → closed` (fluxo de mão única). Filtros: `all` (open+acknowledged), `open`, `acknowledged`. Tipos incluem `invoice_overdue`, `portal_invoice_created`, `portal_consolidation_obsolete`, demurrage, billing, review. Subscription realtime na tabela `alerts` invalida o cache; badges de header derivam de demurrage vencido e granito pendente.

**Dependências** — Tabelas: `alerts`, `bl_containers` (demurrage), `granite_bls`. RPC: `detect_overdue_invoices`. Cache keys: `['alerts', status]`, `['header-alert', ...]`. Eventos de portal originam-se em [Portal do Cliente](portal-cliente.md).

## Relatórios
**Propósito** — Exportação multi-aba em `/relatorios`: operacional, financeiro, por cliente e demurrage.

**Arquivos**
- `src/pages/Relatorios.tsx`
- `src/services/reports.ts`

**Regras** — Limite de 2000 linhas por consulta (aviso se truncado). Operacional filtra por período/POD/modal (KPIs: B/Ls, containers, viagens, peso, CBM). Financeiro filtra por período/status e é admin-only (checagem de permissão `42501`). Clientes agrupa B/Ls por cliente com contagem de faturas e saldo. Demurrage lista `doc_number`, `total_usd`, `frozen_total_brl`, status. Export em XLSX (`exportOperationalReportWorkbook`, `exportFinancialReportWorkbook`, `exportCustomerReportWorkbook`).

**Dependências** — Tabelas: `bls` (joins `customers`, `voyages`, `vessel`, `bl_containers`), `invoices`, `demurrage_invoices`. Cache keys: `['report-operational'|'report-financial'|'report-customers'|'demurrage-report', filters]`. Dados de [Faturamento](faturamento.md) e [Demurrage](demurrage.md).

## Line-Up TV
**Propósito** — Exibição em tela grande/monitor do line-up de navios. `/line-up-tv` redireciona para `/painel`; `/line-up-tv/display` é o modo público/fullscreen.

**Arquivos**
- `src/pages/LineUpTV.tsx` (stub de redirect)
- `src/pages/LineUpTVDisplay.tsx`

**Regras** — Mesmo `fetchLineUpSnapshot` do Painel. Desktop: carrossel animado de 8 linhas em auto-loop; mobile: cards estáticos. Filtra linhas com `atd` (saída efetiva) preenchido. Flash verde a cada refresh; tenta fullscreen na carga. Auto-refresh de 30s.

**Dependências** — Mesmas tabelas do [Painel](#painel) (`voyages`, `bls`, `bl_containers`, `vehicles`, `charge_tables`, `vazios_importacao_*`). Cache key: `['lineup-tv-display-v2']`.

## Admin Usuários
**Propósito** — Gestão de usuários (papéis, ativar/desativar), visualizador de audit log e métricas do sistema, em `/admin/usuarios` (admin-only).

**Arquivos**
- `src/pages/AdminUsuarios.tsx`
- `src/services/adminUsers.ts`

**Regras** — Papéis ativos: **`administrativo`** (acesso total), **`financeiro`** (leitura geral + edição de Taxas Locais/Demurrage/Faturamento/Conciliação e aba financeira de Relatórios), **`operacoes`** (Viagens, upload de manifesto, IMO sheet), **`documentacao`** (leitura ampla, exceto telas de admin). Papéis legados `admin`/`operator` exibidos para compatibilidade. Edição com lock otimista por `updated_at`. Aba de audit log com paginação de 50, filtro por `entity_type` e período. Aba de métricas mostra últimos timestamps de viagem/PIX/fatura.

**Dependências** — Tabelas: `user_profiles` (id, full_name, role, active), `audit_logs` (join `user_profiles` por `changed_by`), `voyages`/`invoices` (métricas). Cache keys: `['admin-users']`, `['admin-audit-logs', filters]`, `['admin-metrics']`. Fronteira de segurança em [segurança](../operations/seguranca.md).

## Revisão
**Propósito** — Fila de **revisão manual que serve de gate antes do faturamento** em `/revisao`: B/Ls e Granites com cliente não vinculado ou pendências operacionais entram na fila; a correção pode disparar emissão automática de fatura ([ADR 0006](../adr/0006-revisao-operacional-reconciliacao-cliente-gate-faturamento.md)).

**Arquivos**
- `src/pages/Revisao.tsx`
- `src/pages/revisaoHelpers.ts`
- `src/components/shared/ReviewInlineEditors.tsx`
- `src/services/review.ts`
- `src/services/reviewBillingAutomation.ts`
- `supabase/migrations/20260619120000_review_gate_canonical_pendencies.sql`

**Regras** — Fila de B/Ls: `bls` com `review_status = 'pending_review'` (até 500). Fila de granito: `granite_bls` com `client_id IS NULL`. **Fila agrupada por cliente:** cliente e consignatário são a mesma entidade chaveada por **CNPJ** (`getReviewItemCnpj`/`groupReviewItems`) — se o CNPJ já está cadastrado, vale a razão social do cliente; senão, o consignatário do manifesto. Ações de nível-cliente resolvem **todos os B/Ls do grupo** de uma vez, todas dentro da própria fila: **vincular cliente**, **adicionar e-mail** (`addCustomerEmail`; qualquer e-mail satisfaz a trava) e **provisionar portal** (admin-only, `provisionPortalForCustomer` com **senha gerada pelo sistema**, exibida uma vez para repasse). Após uma correção de nível-cliente, `recomputeBlReviewGate` reavalia o gate de cada B/L vinculado do grupo (via `save_bl_review` com payload vazio) — os que zeram saem da fila e, se elegíveis, são faturados. A correção individual abre num **drawer lateral** unificado (navegação por `id`, não por índice); ao concluir, o `pendencias` retornado pelo RPC decide se a linha sai da fila (gate zerado) ou permanece com as pendências reduzidas — e o faturamento automático só dispara quando o gate está zerado. A justificativa do drawer é **opcional** (vazia → registra "Revisão manual" no audit log). **Gate canônico:** as pendências que prendem um B/L derivam de estado real via `compute_bl_review_pendencies(bl)`, não do texto de `notes`. As quatro travas confirmadas: (1) cliente não vinculado; (2) cliente sem nenhum e-mail em `customer_contacts` (qualquer `purpose` conta); (3) acesso ao portal não provisionado/ativo (`customer_portal_accounts.active`); (4) peso BB ausente em carga solta (input do cálculo). **CE Mercante não bloqueia** — é necessário para exibição no portal, mas não é inserido neste momento; permanece editável sem prender o B/L. O RPC `save_bl_review` (lock otimista por `expected_updated_at`, conflito → `PT409`) **recomputa** `review_status` pela função canônica e só marca `reviewed` quando o conjunto fica vazio; senão mantém `pending_review` e reescreve a string de pendências (preservando notas humanas). Retorna `{ updated_at, review_status, pendencias }` para a UI não precisar adivinhar se o B/L saiu da fila. Após vincular cliente, `tryAutoIssueInvoice` recalcula as taxas (`calculateBlLocalCharges` com `recalculate`) e: bloqueia se `review_required`/`exempt`/valor ≤ 0; senão chama `markBlReadyAndCreateInvoice` (`status='invoiced'`, sai da fila). Granito tem só vínculo de cliente; se o `charge_status` não ficar `ready_for_billing|invoiced`, exibe aviso de revisão.

**Dependências** — Tabelas: `bls`, `granite_bls`, `customer_contacts`, `customer_portal_accounts`, `audit_logs`. RPC: `save_bl_review`, `compute_bl_review_pendencies`; recálculo via `calculateBlLocalCharges`. Cache keys: `['review-queue']`, `['bls']`, `['granite-bls']`, `['bl-detail', id]`, `['op-count']`. Gate de entrada do [Faturamento](faturamento.md); recebe clientes de [Clientes](clientes.md) e CE Mercante consumida pelo [Portal do Cliente](portal-cliente.md).
