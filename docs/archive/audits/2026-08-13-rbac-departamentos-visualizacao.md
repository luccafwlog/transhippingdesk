# Auditoria RBAC por departamento — o que cada setor vê e edita (2026-08-13)

Snapshot datado. Registro histórico do estado do código em 2026-08-13; o plano
de correção vive em
[`docs/plans/2026-08-13-rbac-leitura-global-por-departamento.md`](../../plans/2026-08-13-rbac-leitura-global-por-departamento.md).

## Propósito e escopo

Mapear, direto do código, o que cada papel (`administrativo`, `financeiro`,
`operacoes`, `documentacao`, `equipamentos`) consegue **visualizar** e
**editar** no sistema interno, e confrontar esse mapa com a intenção declarada
em `CONTEXT.md`. Gatilho: um usuário de Documentação recém-criado não
enxergava a tabela de Taxas Locais — comportamento nunca especificado.

Fora de escopo: Portal do Cliente (RBAC próprio, por CNPJ).

## Onde a autorização mora

São **quatro camadas independentes**, e elas não concordam entre si:

| Camada | Arquivo | O que decide |
|---|---|---|
| Matriz de permissões do frontend | `src/hooks/useAuth.tsx:28-52` | `can(permission)` por papel |
| Gates de tela | páginas e componentes | o que renderiza |
| RLS | `supabase/migrations/*` | o que a API devolve |
| RPCs `SECURITY DEFINER` | `supabase/migrations/*` | o que a escrita aceita |

`CONTEXT.md:1263` chama isso de "Dupla proteção RBAC": a UI orienta, o banco
decide. O problema encontrado é que as camadas divergiram — e a divergência
mais grave é de **leitura**, não de escrita.

## A intenção declarada (CONTEXT.md)

`CONTEXT.md:1233-1252` define os escopos:

- **Visualização global interna** — "Capacidade do perfil Financeiro de abrir
  **todas as telas** e consultar **todos os registros**, sem autorização para
  alterar dados. A única escrita do Financeiro é a conciliação de pagamentos."
- **Operações** — ações completas em Viagens + leitura operacional do resto.
- **Equipamentos** — escrita em VAZIOS EXP e Veículos; "**leitura no restante
  do sistema**".
- **Documentação** — "todas as ações de negócio, incluindo Clientes, Portal,
  B/Ls, Viagens, **Faturamento, taxas, invoices** e alertas, exceto conciliação
  de pagamentos".

Ou seja: **o modelo pretendido restringe escrita, não leitura.** É exatamente a
premissa do relato que originou esta auditoria.

## Achado P0 — leitura financeira restrita a Administrativo no banco

**Evidência: Código** (`supabase/migrations/014_lock_down_financial_reads_and_audit_writes.sql:5-26`)

A migration 014 substituiu as policies de `SELECT` de sete tabelas por
`USING (public.is_admin())`. Migrations posteriores estenderam o mesmo padrão a
mais seis. `is_admin()` (`040_portal_login_rate_limit.sql:25-38`) só reconhece
`admin` e `administrativo`.

Tabelas com **leitura exclusiva de Administrativo** hoje:

| Tabela | Migration |
|---|---|
| `charge_tables`, `charge_table_items` | `014` |
| `customer_rate_overrides` | `014` |
| `charge_calculations` | `014` |
| `invoices`, `invoice_items`, `payments` | `014` |
| `invoice_bls` | `020:96` |
| `bl_receivables`, `invoice_receivable_links`, `ledger_settlements`, `invoice_lifecycle_events` | `066:126-189` |
| `invoice_refunds` | `111:45` |

Consequência prática, para `financeiro`, `operacoes`, `documentacao` e
`equipamentos`:

- **Taxas Locais** (`chargeTableService.ts:58`, `chargeRateService.ts:73/141/216`)
  — lista vazia. É o sintoma relatado.
- **Faturamento** (`billing.ts:113/236/253`) — nenhuma fatura.
- **Relatórios** (`reports.ts:133/277/374`) — números financeiros zerados.
- **Ficha do Cliente**, aba Financeiro (`customerFicha.ts:116/124/132/163/164`)
  — faturas, pagamentos, overrides e serviços manuais vazios.
- **B/L**, linhas de taxa (`chargeOperationsService.ts:304/666`) — vazio.
- **Conciliação PIX** (`reconciliacao.ts:49/360`) — vazio para o próprio
  Financeiro, cuja única escrita autorizada é justamente essa.
- Indicadores derivados em Clientes (`customers.ts:140/207`,
  `useCustomers.ts:195`), Containers (`containers.ts:15`), BLs (`bls.ts:15`).

**Por que passa despercebido:** RLS filtra linhas, não devolve erro. O
PostgREST responde `200 []`. A tela mostra o estado vazio normal — nada em
`classifyDbError` é acionado. O usuário conclui que "não tem dado", não que
"não tem permissão".

**Por que não há teste pegando:** `src/integration/supabase.integration.test.ts:164`
afirma `RLS financeiro permite leitura` e valida apenas
`expect(invoices.error).toBeNull()`. Com RLS negando, `error` é `null` e `data`
é `[]` — o teste passa vacuamente.

**Evidência de que 014 não é o desenho pretendido:** o cabeçalho da migration
`042_rls_module_hardening.sql:16-17` diz "demurrage_invoices: alinha ao padrão
de invoices (014). **SELECT: qualquer ativo**". Quem escreveu 042 já entendia
014 como leitura aberta — e criou `demurrage_invoices_select_active` com
`is_active_user()`. `211_equipamentos_rbac_hardening.sql` depois varreu toda
policy permissiva cujo `qual` contém `is_active_user()` — inclusive essa — e a
reescreveu para `is_active_read_user()` (`211:82-155`), que também inclui
Equipamentos. Resultado: Demurrage é legível por **todos** os papéis, inclusive
Equipamentos; Faturamento continua travado em `is_admin()`. A inconsistência
entre os dois módulos financeiros é acidental.

## Achado P0b — escrita de Taxas Locais também presa a `is_admin()`

**Evidência: Código** (`supabase/migrations/010_rls_by_role.sql:100-104,155-166`)

`charge_tables`, `charge_table_items` e `customer_rate_overrides` entraram no
grupo `admin_only_tables` de `010_rls_by_role.sql` desde o modelo antigo
admin/operator, e nenhuma migration posterior tocou o INSERT/UPDATE/DELETE
delas. `roleHasPermission` (`useAuth.tsx:41-46`) já concede as permissões
`charge_tables` e `charge_overrides` a `documentacao`, e `CONTEXT.md:1249-1252`
inclui "taxas" no escopo de negócio de Documentação — mas a RLS nunca foi
alinhada. Hoje, mesmo com a UI liberando os formulários, `saveChargeTable`,
`saveChargeTableItem`, `saveCustomerRateOverride` e as três operações de
exclusão (`chargeTableService.ts`, `chargeRateService.ts`) falham com `42501`
para qualquer papel que não seja `administrativo`.

Isso é anterior a esta auditoria — não é causado pelo P0 — mas a correção do
P0 o torna visível: sem também corrigir a escrita, Financeiro/Operações
passam a ver a aba de Taxas Locais (depois do Achado P1) com formulários que
sempre falham ao salvar, uma regressão de UX pior do que a tela vazia atual
para quem tenta editar. A correção de leitura e a de escrita precisam andar
juntas.

## Achado P1 — Taxas Locais usa permissão de escrita como gate de leitura

**Evidência: Código** (`src/pages/TaxasLocais.tsx:12-13,30-31,34-51`)

```
const canManageTables = can('charge_tables')
const canManageOverrides = can('charge_overrides')
```

Essas duas flags controlam simultaneamente a renderização das abas e do
conteúdo. Quem não pode gerenciar não vê nada: `financeiro`, `operacoes` e
`equipamentos` abrem `/taxas-locais` e recebem uma página com título e nenhuma
aba. É o único lugar do app onde uma permissão de escrita apaga a tela inteira
— `DemurrageRates.tsx:98-161` e `GraniteRates.tsx:100-163` fazem o certo:
tabela sempre visível, coluna "Ações" e botão de criar sob `isAdmin`.

Mesmo corrigindo o P0, este gate mantém Financeiro e Operações fora da tela.

## Achado P2 — `PROFILE_SCOPES` descreve um modelo que não existe

**Evidência: Código** (`src/services/adminUsers.ts:69-75` vs `useAuth.tsx:38-46`)

O texto exibido no modal de criação de usuário e na tela Admin
(`NovoUsuarioModal.tsx:55`, `AdminUsuarios.tsx:143,289`) promete:

| Papel | `PROFILE_SCOPES` diz | `roleHasPermission` faz |
|---|---|---|
| `financeiro` | "edição em Taxas Locais (Tabelas/Overrides), Demurrage, Faturamento e Conciliação" | só `reconciliacao_edit` |
| `operacoes` | "Cadastro de Viagens, upload de manifestos e planilha IMO" | só `voyages_edit` (sem `manifests_upload`) |

O código concorda com `CONTEXT.md` (Financeiro só concilia; Operações não sobe
B/L); o texto da UI é que está errado — e é ele que o administrador lê antes de
confirmar a mudança de setor.

## Achado P3 — gates de escrita presos a `isAdmin` onde já existe permissão

**Evidência: Código**

| Local | Gate atual | Deveria ser | Efeito |
|---|---|---|---|
| `Viagens.tsx:187` (Nova Viagem) | `isAdmin` | `can('voyages_edit')` | Operações, cujo escopo é "ações completas em Viagens", não cria viagem pela UI — embora `can_edit_voyages()` (`215:9-23`) a autorize no banco |
| `VoyageCard.tsx:309`, `VoyageVisaoTab.tsx:189,263` | `isAdmin` | `can('voyages_edit')` | idem para editar viagem, adicionar escala e omitir POD |
| `Baplie.tsx:228,263` | `isAdmin` | `canImportVazios` (já calculado na linha 39 e usado só na 281) | Documentação tem `manifests_upload` e não consegue reimportar Baplie |

Aqui a UI é **mais restritiva** que o banco. Não é falha de segurança, é papel
que não consegue fazer o próprio trabalho.

## Achado P4 — gates de visualização menores

- `Demurrage.tsx:330` esconde o link "Tarifas" atrás de `isAdmin`, mas
  `/demurrage/taxas` renderiza a tabela para qualquer papel. A restrição é de
  descoberta, não de acesso — inconsistente nos dois sentidos.
- `Clientes.tsx:151` — `canSeePortalQueue` exclui `equipamentos` da fila de
  provisionamento do Portal, contra "leitura no restante do sistema".

## O mapa efetivo hoje

Leitura (`✓` = enxerga, `∅` = tela/lista vazia):

| Módulo | administrativo | financeiro | operacoes | documentacao | equipamentos |
|---|---|---|---|---|---|
| Painel, Viagens, Alertas | ✓ | ✓ | ✓ | ✓ | ✓ |
| B/Ls, Containers, Veículos, Manifestos | ✓ | ✓ | ✓ | ✓ | ✓ |
| Granito, VAZIOS EXP/IMP, Depots | ✓ | ✓ | ✓ | ✓ | ✓ |
| Demurrage (faturas) | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Taxas Locais** | ✓ | ∅ (aba + RLS) | ∅ (aba + RLS) | ∅ (RLS) | ∅ (aba + RLS) |
| **Faturamento / Relatórios / Conciliação** | ✓ | ∅ | ∅ | ∅ | ∅ |
| **Ficha do Cliente → Financeiro** | ✓ | ∅ | ∅ | ∅ | ∅ |
| Admin (`/admin/usuarios`) | ✓ | — | — | — | — |

Escrita, conforme `roleHasPermission` (`useAuth.tsx:28-52`) e coberta por
`src/hooks/__tests__/roleHasPermission.test.ts`:

| Permissão | administrativo | financeiro | operacoes | documentacao | equipamentos |
|---|---|---|---|---|---|
| `admin_panel`, `manage_users` | ✓ | | | | |
| `charge_tables`, `charge_overrides` | ✓ | | | ✓ | |
| `demurrage_edit`, `faturamento_edit` | ✓ | | | ✓ | |
| `reconciliacao_edit` | ✓ | ✓ | | | |
| `voyages_edit` | ✓ | | ✓ | ✓ | |
| `manifests_upload` | ✓ | | | ✓ | |
| `customers_edit`, `portal_provisioning` | ✓ | | | ✓ | |
| `vazios_edit`, `veiculos_edit` | ✓ | | | ✓ | ✓ |
| `depots_edit` | ✓ | | | | ✓ |

Papéis legados mapeiam para `admin → administrativo` e
`operator → documentacao` no frontend (`useAuth.tsx:31-32`) e nas funções SQL
(`215:20`, `215:39`).

## Notas e divergências

- `depots_edit` pertence a `administrativo` e `equipamentos`, mas **não** a
  `documentacao` — enquanto `vazios_edit` e `veiculos_edit` pertencem. Depot é
  cadastro de apoio de VAZIOS EXP; a exclusão parece deliberada
  (`230_depot_rbac.sql`), mas não está registrada em `CONTEXT.md`.
- As rotas internas não são gate de autorização: só `/admin/usuarios` passa por
  `ProtectedRoute adminOnly` (`App.tsx:168`). Toda outra tela abre para
  qualquer perfil ativo, e a autoridade real fica em RLS/RPC — o que torna o
  P0 ainda mais silencioso.
- `is_active_user()` foi redefinida em `211:11-21` para excluir
  `equipamentos`; `is_active_read_user()` é a versão que inclui. Qualquer
  policy de leitura nova deve usar `is_active_read_user()`, não
  `is_active_user()`.
