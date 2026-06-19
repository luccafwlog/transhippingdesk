# Clientes
> **Status:** ativo · **Atualizado:** 2026-06-19 · **Rotas:** `/clientes`, `/clientes/:cnpj`

## Propósito
Cadastro mestre de clientes (Customer Master) do Transhipping Desk: identificação fiscal por CNPJ/CPF, contatos, importação em massa pela planilha *base-clientes*, reconciliação/fuzzy matching de clientes vindos dos manifestos e gestão do acesso ao [Portal do Cliente](portal-cliente.md). O cliente é a entidade que recebe faturas — por isso o cadastro é pré-requisito do [Faturamento](faturamento.md) e da [Revisão](operacao-suporte.md#revisão).

## Como funciona
- `/clientes` (`Clientes.tsx`) renderiza a lista mestre paginada (50 linhas/página) com busca, filtros, seleção em massa (admin), exportação e o fluxo de importação *base-clientes*. Cada linha navega para `/clientes/:cnpj` usando `cnpj_cpf` como chave.
- `/clientes/:cnpj` (`ClienteFicha.tsx`) é a ficha do cliente: formulário do mestre (razão social, endereço, cidade/UF/CEP, notas), CRUD de contatos, histórico de B/Ls e de faturas, e o painel de provisionamento de acesso ao portal (somente admin).
- O documento é normalizado para dígitos (`onlyDigits`) e validado como **CPF (11 dígitos) ou CNPJ (14 dígitos)**; a exibição usa `formatCnpjCpf()`.

## Componentes e arquivos
| Camada | Arquivo | Responsabilidade |
|---|---|---|
| Page | `src/pages/Clientes.tsx` | Lista mestre, busca/filtros, importação *base-clientes*, export |
| Page | `src/pages/ClienteFicha.tsx` | Ficha do cliente, contatos, provisionamento de portal |
| Hook | `src/hooks/useCustomers.ts` | Queries React Query: lista, summary, detalhe, lookup |
| Service | `src/services/customers.ts` | CRUD de `customers`/`customer_contacts`, RPCs de conta de portal, invoke `provision-portal-user` |
| Service | `src/services/customerBase.ts` | Parse e importação da planilha *base-clientes* |
| Service | `src/services/customerReconciliation.ts` | `loadCustomerMaps`, `findMatchedCustomer` (fuzzy matching) |
| Migration | `supabase/migrations/20260618145508_preserve_customer_billing_block_reason.sql` | Preserva o motivo de bloqueio de faturamento por reconciliação |
| Migration | `supabase/migrations/20260619130000_review_gate_hardening.sql` | Torna portal ativo dependente de `auth_user_id` e endurece RPCs administrativas |

Cache keys (`useCustomers.ts`): `['customers', filters]`, `['customers-summary', filters]`, `['customer-detail', cnpj]`, `['customer-lookup', search]`; a ficha usa `['customer-portal-account', id]`.

## Regras de negócio
- **Identificação:** campo `cnpj_cpf`, armazenado só com dígitos; aceita CPF (11) ou CNPJ (14). Serve de chave de rota e de identidade do cliente.
- **Contatos:** `upsertCustomerContact(customerId, contact)` insere/atualiza (`is_primary`, `purpose` ∈ `geral|operacional|faturamento|financeiro`); `deleteCustomerContact(contactId)` remove um contato.
- **Importação *base-clientes*:** `parseCustomerBaseFile(file)` lê `.xlsx/.xls/.csv` via SheetJS e mapeia colunas (`cnpj/cpf`, `razao social`, `nome fantasia`, `email`, `endereco`, `cidade`, `uf`, `cep`). Obrigatórias: CNPJ/CPF e Razão Social. `importCustomerBaseRows(rows)` faz upsert deduplicando por `cnpj_cpf`, mescla múltiplos e-mails em contatos e revincula retroativamente B/Ls não vinculados cujo `manifest_customer_cnpj_cpf` bate. Retorna `{ imported, updated, contactsCreated, blsLinked }`.
- **Reconciliação / fuzzy matching:** `loadCustomerMaps()` carrega todos os clientes (paginado de 1000) em quatro índices — por documento, por nome normalizado, por nome canônico e uma lista canônica para iteração fuzzy. `canonicalizeName()` aplica `normalizeText` (lowercase, sem diacríticos), remove sufixos societários (LTDA, S/A, EIRELI, EPP, ME, etc.) e colapsa espaços. `findMatchedCustomer(candidate, maps)` resolve em cascata: (1) documento exato → `document`; (2) nome normalizado exato → `name`; (3) nome canônico exato → `name`; (4) Levenshtein ≥ 0,90 com guarda de primeira palavra idêntica → `name`.
- **Billing block reason:** quando a reconciliação de cliente bloqueia o faturamento, um B/L pode terminar sem linhas de cobrança — o que **não** significa que seu POD/modal não tenha tabela de tarifas válida. A migration `20260618145508` recria `import_manifest_with_postprocess_transactional()` para preservar o motivo específico de hold produzido por `run_billing_for_import_batch`, evitando que o motivo seja sobrescrito por um genérico, e insere os e-mails de contato do manifesto em `customer_contacts`.
- **Provisionamento de portal:** na ficha, o admin define `portal_email` + senha (mín. 8 caracteres); na fila de revisão, a senha é gerada pelo sistema. Em ambos os caminhos a sequência é **criar/atualizar a conta inativa → invocar `provision-portal-user` → exigir `auth_user_id` → ativar**. A Edge Function cria/atualiza o usuário Supabase Auth e grava `auth_user_id`/`portal_email`. Os RPCs recusam ativação sem vínculo Auth e removem a assinatura antiga de `upsert_customer_portal_account`, evitando contas aparentemente ativas mas impossíveis de autenticar. Ver [Portal do Cliente](portal-cliente.md).

## Dependências
- **Tabelas:** `customers`, `customer_contacts`, `customer_rate_overrides`, `customer_portal_accounts`, `customer_portal_sessions`, `customer_reconciliation_queue` (SET NULL ao excluir cliente); leitura de `bls`, `invoices`, `demurrage_invoices`, `bl_receivables`, `billing_batches` para histórico e checagens de dependência antes de excluir.
- **RPCs:** `get_customer_portal_account`, `upsert_customer_portal_account`, `set_customer_portal_account_active`.
- **Integrações externas:** Edge Function `provision-portal-user` (Supabase Auth admin); SheetJS para parse de planilha.
- **Outros módulos:** [Faturamento](faturamento.md), [Revisão](operacao-suporte.md#revisão), [Reconciliação PIX](reconciliacao-pix.md), [Portal do Cliente](portal-cliente.md). Termos em [Glossário](../GLOSSARIO.md); regras transversais em [regras-de-negócio](../operations/regras-de-negocio.md).

## Notas e divergências
- A exclusão de cliente é guardada por dependências fiscais (faturas, receivables, batches) — ver [segurança](../operations/seguranca.md) e [ARCHITECTURE](../ARCHITECTURE.md).
- `customer_rate_overrides` aparece no cadastro mas a manutenção de tarifas por cliente é responsabilidade de [Taxas Locais](taxas-locais.md).
- O fuzzy matching usa guarda de primeira palavra para reduzir falsos positivos; nomes muito curtos ou genéricos ainda podem exigir revisão manual na [Revisão](operacao-suporte.md#revisão).
