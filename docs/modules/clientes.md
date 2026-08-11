# Clientes

> **Status:** ativo · **Atualizado:** 2026-06-20 · **Rotas:** `/clientes`, `/clientes/:cnpj`

## Propósito e escopo

O módulo mantém o cadastro mestre de clientes, seus contatos, o vínculo com B/Ls e invoices e o provisionamento administrativo da Conta de Portal. As rotas são internas, montadas sob `ProtectedRoute` e `AppLayout` em `src/App.tsx`; seleção/exclusão em massa e gestão do Portal aparecem somente para admin, mas a fronteira efetiva continua nas policies e RPCs do Supabase.

`clientes.md` é dono do ciclo cadastral e do adaptador interno de provisionamento. Autenticação, sessão e autosserviço externos pertencem a [Portal do Cliente](portal-cliente.md); reconciliação manual e gate de faturamento pertencem a [Operação e suporte](operacao-suporte.md).

## Reconciliação de cliente em B/L e Granito

CPF/CNPJ exato, normalizado para dígitos, pode preencher automaticamente o
cliente. Match por nome nunca preenche `customer_id` ou `client_id`: fica em
`bls.suggested_customer_id` ou `granite_bls.suggested_client_id`, aparece como
“Sugerido” na fila `/revisao` e exige confirmação humana. O faturamento ignora
as colunas de sugestão. O backfill preserva faturados e decisões manuais; suas
consultas de impacto devem ser executadas em somente-leitura antes da aplicação.

Fontes executáveis principais: `src/pages/Clientes.tsx`, `src/components/customers/CustomerTable.tsx`, `src/components/customers/CreateCustomerModal.tsx`, `src/components/customers/ImportBaseModal.tsx`, `src/components/customers/customerCreateForm.ts`, `src/pages/ClienteFicha.tsx`, `src/components/clientes/FichaTabs.tsx`, `src/components/clientes/fichaTabConfig.ts`, `src/components/clientes/VisaoGeralTab.tsx`, `src/components/clientes/CadastroContatosTab.tsx`, `src/components/clientes/OperacionalTab.tsx`, `src/components/clientes/FinanceiroTab.tsx`, `src/components/clientes/HistoricoTab.tsx`, `src/hooks/useCustomers.ts`, `src/hooks/useCustomerFicha.ts`, `src/services/customers.ts`, `src/services/customerFicha.ts`, `src/services/portalProvisioning.ts`, `src/services/customerBase.ts`, `src/services/customerReconciliation.ts`, `src/services/deleteDependencies.ts`, `src/services/deleteAudit.ts`, `src/services/exports.ts` e `supabase/migrations/129_review_gate_hardening.sql`.

## Anatomia das telas

### `/clientes`

`src/pages/Clientes.tsx` compõe a tela e mantém o estado local de filtros, seleção, modais e mutações. As unidades visuais são `src/components/customers/CustomerTable.tsx`, `src/components/customers/CreateCustomerModal.tsx` (incluindo o formulário de contato) e `src/components/customers/ImportBaseModal.tsx`:

- cards resumidos de clientes, B/Ls, taxas e saldo;
- busca por nome, fantasia ou documento e filtros por email, existência de B/L e saldo;
- tabela paginada em 50 linhas, ordenável por cliente, quantidade de B/Ls e saldo;
- seleção por linha/página e exclusão controlada, visíveis somente para admin;
- atalhos para ficha e faturamento, criação manual, importação da base e exportação XLSX;
- estados explícitos de loading, erro e vazio; modais de cadastro e preview da planilha.

A consulta usa paginação no Supabase apenas no caso simples. Filtros dependentes de contatos/saldo e ordenações calculadas carregam o conjunto candidato, filtram/ordenam no cliente e só depois recortam a página (`src/hooks/useCustomers.ts`).

### `/clientes/:cnpj`

`src/pages/ClienteFicha.tsx` usa o parâmetro `:cnpj` diretamente como chave de `customers.cnpj_cpf` e monta um hub de 5 abas (`src/components/clientes/fichaTabConfig.ts`, navegação por `?tab=` via `FichaTabBar`), todas lendo o mesmo `data` de `useCustomerDetail` mais suas próprias queries de `src/hooks/useCustomerFicha.ts` (`src/services/customerFicha.ts`):

- **Visão Geral** (`VisaoGeralTab`): saldo consolidado (local + demurrage), identidade resumida e uma lista de pendências (reconciliação de cliente, Portal não ativo, invoices/demurrage vencidas, disputas abertas, containers com demurrage correndo) — cada fonte tem estado explícito de carregamento/erro antes de contar como "sem pendência"; atividade recente (5 últimos eventos da timeline).
- **Cadastro & Contatos** (`CadastroContatosTab`): mestre editável com justificativa obrigatória e auditoria; contatos com finalidade e indicador principal; painel de provisionamento do Portal embutido.
- **Operacional** (`OperacionalTab`): reconciliação de cliente pendente e histórico de B/Ls vinculados.
- **Financeiro** (`FinanceiroTab`): invoices locais, invoices de demurrage, recebíveis (ledger local, lido via RPC `get_customer_receivables`), pagamentos, overrides de tarifa e B/Ls com cobrança manual — cada tabela distingue carregando/erro/restrito/vazio.
- **Histórico** (`HistoricoTab`): timeline completa (auditoria de cadastro, eventos do Portal, contato criado, invoice emitida, pagamento local recebido, demurrage emitida/paga, B/L vinculado), ordenada da mais recente para a mais antiga.

Loading com skeleton e um estado único para documento ausente, inválido, não encontrado ou erro de consulta cobrem a página inteira, antes de qualquer aba montar.

`useCustomerDetail` carrega `customers`, `customer_contacts` e `bls`, e pagina `invoices` até esgotar (não trunca em uma janela fixa — o saldo pendente é um agregado exato). O provisionamento é consultado e alterado na fila `/clientes/portal`.

## Catálogo de ações

| Tela / ação | Pré-condições | Origem | Orquestração | Persistência | Efeitos e cache | Falhas | Evidência |
|---|---|---|---|---|---|---|---|
| `/clientes` — buscar e filtrar | Usuário interno ativo; termos/filtros opcionais | `Clientes`, `setFilterField` | `useCustomers`/`useCustomerSummary`; busca base no Supabase e filtros de contato, email, B/L e saldo em `filterCustomerRowsByClientSideFilters` | Leitura de `customers`, `customer_contacts`, `bls` e invoices emitidas | Reseta página; queries `['customers', filters]` e `['customers-summary', filters]` | Erro da consulta exibe erro da lista; resumo pode falhar em query própria | **Teste:** `src/hooks/__tests__/useCustomersFilters.test.ts`; **Código:** `src/hooks/useCustomers.ts` |
| `/clientes` — paginar e ordenar | Resultado carregado | `CustomerTable`, botões de cabeçalho e paginação | `toggleSort`, `sortCustomerRows`; ordenação não padrão força varredura e paginação client-side | Somente leitura | Atualiza `filters.sortKey`, `sortDirection` ou `page`; nova chave de query | Custo cresce com o conjunto quando filtro/ordenação exige processamento local | **Teste:** `src/lib/__tests__/customerTableViewModel.test.ts`; **Código:** `src/components/customers/CustomerTable.tsx`, `src/hooks/useCustomers.ts` |
| `/clientes` — selecionar linhas | Admin; linhas na página | Checkboxes em `CustomerTable` e `BulkActionsBar` | `useRowSelection` recebe um escopo formado pelos filtros, ordenação e página; “selecionar todos” atua nos IDs visíveis | Nenhuma | Seleção é limpa ao trocar o escopo ou após exclusão | Não mantém IDs invisíveis de outra página/filtro | **Código:** `src/pages/Clientes.tsx`, `src/components/customers/CustomerTable.tsx`, `src/hooks/useRowSelection.ts` · **Teste:** `src/hooks/__tests__/useRowSelection.test.tsx` |
| `/clientes` — abrir ficha/faturamento | Linha existente | Links “Ficha” e ícone financeiro em `CustomerTable` | React Router; `buildCustomerBillingUrl` | Nenhuma | Navega para `/clientes/{cnpj_cpf}` ou `/faturamento?tab=invoices&customer=...` | Rota de ficha falha se a chave não coincidir exatamente | **Teste:** `src/lib/__tests__/customerTableViewModel.test.ts`; **Código:** `src/components/customers/CustomerTable.tsx` |
| `/clientes` — criar cliente | CNPJ/CPF com 11/14 dígitos; razão social com 2+ caracteres; contatos parcialmente preenchidos precisam de nome | `CreateCustomerModal`, `handleCreateCustomer` | Zod → `createCustomer` → RPC `create_customer_with_contacts`; documento normalizado com `onlyDigits` | Cliente e contatos são inseridos na mesma transação; o trigger da migration `193` cria a linha inicial da Conta de Portal e seu evento de auditoria, sem convite ou email | Invalida `['customers']` e `['customer-lookup']`; navega à ficha | Duplicidade, contato inválido ou erro de banco revertem toda a criação | **Código:** `src/pages/Clientes.tsx`, `src/components/customers/CreateCustomerModal.tsx`, `src/services/customers.ts`, `supabase/migrations/143_create_customer_with_contacts_atomic.sql`, `supabase/migrations/193_portal_account_on_customer_insert.sql` · **Teste:** `src/services/__tests__/customerCreateAtomic.test.ts` |
| `/clientes` — importar planilha | `.xlsx`, `.xls` ou `.csv` dentro do limite; cabeçalhos CNPJ/CPF e Razão Social | `ImportBaseModal`, `handleBaseFile`/`handleImportBase` | `assertUploadSize` → import dinâmico de `@e965/xlsx` → `parseCustomerBaseRows` → `importCustomerBaseRows` | UPSERT `customers`; INSERT de novos `customer_contacts`; UPDATE de `bls.customer_id` | Preview com linhas válidas/ignoradas; invalida `['customers']`, `['customer-lookup']`, `['bls']` | Arquivo grande, aba/cabeçalho inválido, documento/nome ausente ou falha em qualquer escrita | **Teste:** limite em `src/services/__tests__/uploadLimits.test.ts`; **Código:** `src/components/customers/ImportBaseModal.tsx`, `src/services/customerBase.ts` |
| `/clientes` — exportar conjunto filtrado | Consulta disponível | `handleExportBase` | Busca todos os clientes por nome, aplica filtros client-side e `exportCustomerBaseWorkbook` | Leitura de `customers`, `customer_contacts`, `bls`, invoices; download XLSX local | Não altera cache; exporta todas as páginas filtradas, não só a página corrente | Toast genérico; veja divergência sobre busca/ordenação/email | **Código:** `src/pages/Clientes.tsx`, `src/services/exports.ts` |
| `/clientes` — inspecionar dependências e excluir em massa | Admin; ao menos um ID selecionado | `runCustomerDelete`/`BulkActionsBar` e menu de `CustomerTable` | `checkCustomerDependencies` gera deletáveis e bloqueados; confirmação; `deleteCustomers` | SELECT em `bls`, `invoices`, `demurrage_invoices`, `bl_receivables`, `billing_batches`; DELETE `customer_contacts`, `customer_rate_overrides`, `customers`; INSERT best-effort em `audit_logs` | Exclui apenas IDs liberados; limpa seleção; invalida `customers`, `customers-summary`, `customer-lookup` | Todos bloqueados, cancelamento, erro de leitura/delete; falha de auditoria só gera telemetria | **Teste:** `src/services/__tests__/customers.delete.test.ts`; **Código:** `src/pages/Clientes.tsx`, `src/components/customers/CustomerTable.tsx`, `src/services/deleteAudit.ts` |
| `/clientes/:cnpj` — carregar ficha completa | `:cnpj` presente e igual ao documento persistido | `useCustomerDetail`; query da Conta de Portal para admin | Query mestre/contatos/B/Ls → query de invoices → `getCustomerPortalAccount` | SELECT em `customers`, `customer_contacts`, `bls`, `invoices`; RPC `get_customer_portal_account` | Queries `['customer-detail', cnpj]` e `['customer-portal-account', id]` | Permissão de invoices vira lista vazia com `invoices_access_denied`; demais erros caem no estado genérico | **Código:** `src/hooks/useCustomers.ts`, `src/pages/ClienteFicha.tsx` |
| `/clientes/:cnpj` — editar mestre | Cliente carregado; usuário presente; `customers_edit` (`can_edit_customers` no RPC/RLS); justificativa não vazia | `saveCustomer` (aba Cadastro & Contatos) | `updateCustomerWithAudit` calcula apenas campos alterados | UPDATE `customers`, depois INSERT em `audit_logs` por campo | Invalida `['customer-detail', cnpj]` e `['customers']`; limpa justificativa | Nenhuma alteração gera aviso; update e auditoria não estão na mesma transação; sem `customers_edit` a RPC e a RLS de `customers` recusam com `42501` | **Código:** `src/components/clientes/CadastroContatosTab.tsx`, `src/services/customers.ts`, `supabase/migrations/215_rbac_voyages_customers_writes.sql` |
| `/clientes/:cnpj` — criar/editar contato | Cliente carregado; `customers_edit`; nome obrigatório | `saveContact` (aba Cadastro & Contatos) | `upsertCustomerContact` decide INSERT/UPDATE pelo `contact.id` | INSERT/UPDATE `customer_contacts` | Invalida `['customer-detail', cnpj]` e `['customer-ficha', 'timeline', customerId]`; limpa formulário | Toast genérico em falha; sem `customers_edit` a RLS de `customer_contacts` recusa | **Código:** `src/components/clientes/CadastroContatosTab.tsx`, `src/services/customers.ts` · **Teste:** `src/components/clientes/__tests__/CadastroContatosTab.test.tsx` |
| `/clientes/:cnpj` — remover contato | Confirmação explícita; `customers_edit` | `deleteContact` (aba Cadastro & Contatos) | `deleteCustomerContact` | DELETE `customer_contacts` por ID | Invalida `['customer-detail', cnpj]` e `['customer-ficha', 'timeline', customerId]` | Cancelamento ou erro do banco | **Código:** `src/components/clientes/CadastroContatosTab.tsx`, `src/services/customers.ts` · **Teste:** `src/components/clientes/__tests__/CadastroContatosTab.test.tsx` |
| `/clientes/portal` — revisar e enviar convite | Documentação/Administrativo; cliente sem conta ativa; email não suprimido | `ClientesPortal` | `portal-invite-send` gera token opaco, registra hash e envia email | `portal_invites`, `portal_email_attempts`, `customer_portal_accounts` | Ativação pendente ou falha de envio; token nunca chega ao navegador | Email inválido/suprimido, permissão, conta ativa ou rate limit | **Código:** `supabase/functions/portal-invite-send/index.ts` |
| `/clientes/:cnpj` — rota inválida/não encontrada | Documento ausente, formatado ou inexistente | Estado terminal de `ClienteFicha` | `useCustomerDetail` só habilita com valor; consulta por igualdade exata | SELECT `customers` por `cnpj_cpf` | Nenhuma navegação automática | Ausência/PGRST116 mostra “Cliente não encontrado”; demais erros mostram falha de consulta distinta | **Código:** `src/pages/ClienteFicha.tsx`, `src/hooks/useCustomers.ts` · **Teste:** `src/pages/__tests__/ClienteFicha.behavior.test.tsx` |

## Estado e dados

| Estado/fonte | Dono e formato | Observações |
|---|---|---|
| `['customers', filters]` | `useCustomers` | Lista e total da paginação; filtros/ordenação fazem parte da chave. |
| `['customers-summary', filters]` | `useCustomerSummary` | Reexecuta a busca sem paginação; `staleTime` de 60 s. |
| `['customer-detail', cnpj]` | `useCustomerDetail` | Mestre, contatos, B/Ls, todas as invoices (paginadas até esgotar) e saldo apenas de status `issued`. |
| `['customer-lookup', search]` | `useCustomerLookup` | Habilitada com 2+ caracteres; até 25 resultados. |
| `['customer-portal-account', customerId]` | `ClienteFicha` | Somente admin; `retry:false`. |
| `['customer-ficha', 'demurrage-invoices', customerId]` | `useCustomerDemurrageInvoices` | Aba Financeiro/Visão Geral; `Restrictable` (`{ rows, denied }`); paginado até esgotar. |
| `['customer-ficha', 'receivables', customerId]` | `useCustomerReceivables` | Aba Financeiro; lê via RPC `get_customer_receivables` (não a tabela direto — a RLS de `bl_receivables` é `is_admin()`-only e devolveria lista vazia silenciosa para outros perfis); `Restrictable`. |
| `['customer-ficha', 'payments', customerId]` | `useCustomerPayments` | Aba Financeiro; `Restrictable`; paginado até esgotar. |
| `['customer-ficha', 'rate-overrides', customerId]` | `useCustomerRateOverrides` | Aba Financeiro; paginado até esgotar. |
| `['customer-ficha', 'manual-charge-bls', customerId]` | `useCustomerManualChargeBls` | Aba Financeiro; paginado até esgotar. |
| `['customer-ficha', 'pending-reconciliation', customerId]` | `useCustomerPendingReconciliation` | Abas Visão Geral/Operacional; só `matched_name` (documento exato resolve sozinho — `isCustomerReconciliationResolved`). |
| `['customer-ficha', 'running-demurrage', customerId]` | `useCustomerRunningDemurrage` | Aba Visão Geral; paginado até esgotar. |
| `['customer-ficha', 'timeline', customerId]` | `useCustomerTimeline` | Abas Visão Geral/Histórico; invalidada também por mutações de contato (`CadastroContatosTab`), não só por `['customer-detail', cnpj]`. |
| Filtros, seleção, modais e formulários | Estado local das páginas | Não persistem na URL, exceto a própria rota da ficha e a aba ativa (`?tab=`). |
| `customers.cnpj_cpf` | Identidade cadastral | UNIQUE e NOT NULL desde `supabase/migrations/001_schema.sql`; criação/importação persistem apenas dígitos. |
| `customer_contacts` | Contatos do cliente | Finalidade aceita: `geral`, `operacional`, `faturamento`, `financeiro`. |
| `customer_portal_accounts` | Conta técnica do Portal | Relaciona cliente a `auth.users` por `auth_user_id`; `active` não substitui o vínculo Auth. |

O saldo da lista não usa `customers.pending_balance`: `fetchIssuedInvoiceBalanceByCustomer` percorre invoices `issued`. A ficha aplica a mesma noção sobre as invoices que conseguiu ler. Dados de matching ficam em quatro mapas em memória, carregados em páginas de 1.000 registros por `loadCustomerMaps`.

## Fluxos e invariantes

1. **Identidade normalizada:** CPF tem 11 dígitos e CNPJ 14. Criação, importação e login de Portal removem pontuação; `customers.cnpj_cpf` é a identidade única.
2. **Chave de rota:** `/clientes/:cnpj` consulta igualdade exata. Links internos usam o valor persistido; deep links devem usar os 11/14 dígitos canônicos.
3. **Contatos:** `purpose` pertence ao conjunto `geral/operacional/faturamento/financeiro`; `is_primary` é preferência de exibição, não unicidade garantida pelo service.
4. **Importação e dedupe:** o parser mescla linhas do mesmo documento, preserva o melhor texto e a união de emails; a persistência faz UPSERT por `cnpj_cpf`, evita emails já existentes e vincula retroativamente B/Ls ainda sem cliente quando `manifest_customer_cnpj_cpf` coincide.
5. **Precedência de matching:** documento exato → nome normalizado exato → nome canônico exato → Levenshtein `>= 0,90`. O fuzzy só compara candidatos cujo primeiro token canônico seja idêntico.
6. **Conta ativa funcional:** `active=true` requer `auth_user_id` e email técnico. A sequência canônica é convite aprovado → ativação pelo cliente → identidade técnica vinculada → login por CNPJ.
7. **Edge Functions:** convite, ativação, recuperação e suspensão são fronteiras server-side; o navegador nunca conhece o email técnico e não escolhe a conta diretamente.
8. **Hard delete:** a UI é admin-only, RLS de `customers`/`customer_contacts` reserva DELETE a admin (`supabase/migrations/010_rls_by_role.sql`) e o service bloqueia qualquer cliente com B/L, invoice local, invoice de demurrage, recebível ou lote. Contatos e overrides são removidos antes do mestre; exclusão em massa pode prosseguir parcialmente.

## Testes e validação

Os testes abaixo foram inspecionados, mas não executados nesta cartografia, conforme coordenação do Plano 04.

| Evidência | Tipo | O que sustenta | Limite |
|---|---|---|---|
| `src/services/__tests__/customers.test.ts` | **Teste** unitário | Erros de RPC, saldo `issued`, sequência conta inativa → Function → ativação e bloqueio sem `auth_user_id` | Supabase, Auth e Function são mocks; não prova deploy/runtime. |
| `src/services/__tests__/customers.delete.test.ts` | **Teste** unitário | Bloqueio por B/L/fatura, delete parcial e ordem contatos → overrides → cliente | Não prova RLS, FKs ou auditoria real. |
| `src/services/__tests__/customerReconciliation.test.ts` | **Teste** unitário | Precedência, canonização e guarda do primeiro token no fuzzy | Não carrega uma base real. |
| `src/hooks/__tests__/useCustomersFilters.test.ts` | **Teste** unitário | Filtro de email e cards derivados | Não cobre paginação híbrida nem consulta Supabase. |
| `src/lib/__tests__/customerTableViewModel.test.ts` | **Teste** unitário | Ordenação, chips, contato principal e URL de faturamento | Não cobre interação completa da página. |
| `src/services/__tests__/uploadLimits.test.ts` | **Teste** unitário | Rejeição de planilha acima do limite antes de `arrayBuffer` | Não cobre parsing/importação de fixture válida. |
| `src/services/__tests__/reviewGateHardeningMigration.test.ts` | **Teste de contrato SQL** | Presença textual do gate `active + auth_user_id` e rejeição de ativação inválida | Regex/conteúdo de migration; não executa PostgreSQL nem confirma migration aplicada. |

**Runtime não executado.** Validação futura precisa registrar ambiente e dados controlados para: criar cliente e contatos; importar XLSX/CSV com duplicatas, erros e B/L retroativo; editar mestre e conferir `audit_logs`; provisionar/criar/resetar/desativar usuário Auth real; tentar ativação sem `auth_user_id`; excluir lote misto e conferir bloqueios, RLS, cascatas/SET NULL e auditoria.

## Provisionamento do Portal

O cabeçalho desta página é o ponto de entrada para `/clientes/portal`, com badge de Clientes aguardando análise. A ficha mantém resumo, botão “Gerenciar Portal” e deep link por ID; contatos continuam candidatos e não sincronizam o Email de Recuperação.

## Notas e divergências

- **Suspeita — exportação não espelha integralmente a visão.** `handleExportBase` exporta todas as páginas filtradas, mas não reaplica a ordenação ativa, omite a cláusula de documento normalizado usada por `useCustomers` e `exportCustomerBaseWorkbook` grava a coluna Email vazia. Uma busca por documento formatado ou a expectativa de round-trip pode produzir arquivo diferente da tabela.
- **Código — update e auditoria não são atômicos.** `updateCustomerWithAudit` atualiza `customers` antes de inserir `audit_logs`; falha da auditoria deixa o cadastro alterado embora a UI informe falha.
- **Código — mensagem de migration desatualizada.** `normalizeCustomerPortalRpcError` orienta aplicar `025_billing_orchestration_portal.sql`, enquanto o contrato vigente de ativação foi endurecido por `supabase/migrations/129_review_gate_hardening.sql`.
- `customer_rate_overrides` é apagado junto do hard delete, mas sua manutenção funcional pertence a [Taxas Locais](taxas-locais.md).
