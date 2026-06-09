# WORKFLOW.md — Transhipping Desk

Guia operacional e técnico completo do sistema. Documento de referência para
onboarding de desenvolvedores, manutenção e evolução. Última atualização:
2026-05-30 (auditoria completa).

> Para diretrizes de estilo e comportamento de desenvolvimento, ver `CLAUDE.md`.
> Para o diagrama de fluxo de negócio canônico, ver `docs/ARCHITECTURE.md`.
> Para estado/roadmap, ver `docs/ROADMAP.md`.

---

## 1. Visão geral do sistema

**Transhipping Desk** é um sistema interno de gestão de operações portuárias de
*transhipment* (transbordo) para a **Transhipping Agenciamento Marítimo Ltda.**
Está em **produção**. Cobre o ciclo completo:

1. **Operação** — viagens (navios em escala), manifestos (CNTR, break-bulk,
   granito), containers, veículos (RoRo), baplie EDI e vazios (import/export).
2. **Revisão** — fila de aprovação manual de B/Ls antes do faturamento.
3. **Comercial** — clientes, tabelas de taxas locais e overrides por cliente.
4. **Financeiro** — taxas locais, faturamento (invoices), demurrage e
   conciliação de pagamentos PIX.
5. **Portal do cliente** — autenticação própria para o cliente consultar
   faturas e saldo em aberto.

O domínio e a UI são em **português**; o código estrutural é em **inglês**.

---

## 2. Arquitetura completa

```
┌──────────────────────────────────────────────────────────────────┐
│                          NAVEGADOR (SPA)                           │
│  React 19 + TypeScript + Vite + Tailwind v4 + React Router v7      │
│                                                                    │
│  pages/  ──usa──▶  hooks/ (React Query v5)  ──chama──▶  services/  │
│     │                                                       │      │
│     └── components/ (ui, layout, shared, billing, ...)      │      │
│                                                             │      │
│  Auth interna: Supabase Auth (useAuth)                      │      │
│  Auth portal:  Supabase Auth + fallback token (usePortalAuth)│     │
└─────────────────────────────────────────────────────────────┼─────┘
                                                               │ HTTPS / WSS
                                          ┌────────────────────▼─────────────────┐
                                          │            SUPABASE                   │
                                          │  Postgres + RLS  (90+ migrations)     │
                                          │  Auth (JWT)                           │
                                          │  RPCs (SECURITY DEFINER, ~70 funções) │
                                          │  Edge Functions (Deno):               │
                                          │   • provision-portal-user             │
                                          │   • notify-invoice-issued (webhook)   │
                                          │  Database Webhooks → Edge Function     │
                                          └───────────────┬───────────────────────┘
                                                          │
                                       ┌──────────────────┴───────────────┐
                                       │  Integrações externas             │
                                       │   • Resend (email de fatura)      │
                                       │   • Banco Central / olinda (ROE)  │
                                       │   • PIX (payload gerado no cliente │
                                       │     e no banco via RPC)           │
                                       └───────────────────────────────────┘

Deploy: GitHub Actions → build (Vite) → Firebase Hosting (SPA estática)
```

**Princípios arquiteturais aplicados:**

- **Separação service/hook/page**: `services/` são funções puras de acesso a
  dados (recebem/importam o cliente Supabase); `hooks/` encapsulam React Query
  (cache, mutations, invalidação); `pages/` consomem hooks e renderizam UI.
- **Segurança no banco (RLS-first)**: a autorização real vive em políticas RLS
  e funções `SECURITY DEFINER`. As checagens no cliente (`can()`, `isAdmin`)
  são apenas para UX — não são a fronteira de segurança.
- **Lógica financeira transacional no banco**: criação de invoices,
  numeração, consolidação e PIX são RPCs transacionais em PL/pgSQL para
  garantir atomicidade.
- **Lazy loading por rota**: cada página é um chunk dinâmico (`lazyPage()`);
  bibliotecas pesadas (`xlsx`, `jspdf`) são importadas dinamicamente.

---

## 3. Estrutura de diretórios

```
src/
  App.tsx              # Rotas + lazy loading de todas as páginas
  main.tsx             # Bootstrap: QueryClient, providers, ErrorBoundary
  index.css            # Tailwind v4 + design tokens (variáveis CSS de tema)

  pages/               # Uma página por rota (export nomeado, sem default)
  components/
    ui/                # Primitivos: Button, Input, Modal, Badge, Card, Toast,
                       #   ConfirmDialog, Combobox, Skeleton
    layout/            # AppLayout, ProtectedRoute, PortalProtectedRoute
    shared/            # Componentes de domínio entre páginas (modais de import)
    billing/           # Documentos de fatura (taxas locais) + ValidacaoTab
    demurrage/         # Documento de fatura (demurrage)
    lineup/            # Tabela de line-up
  hooks/               # use* — React Query + lógica de domínio
  services/            # Acesso ao Supabase + parsers de arquivo
    charges/           # Sub-módulo de taxas locais (rate/operations/table/recon)
    demurrage/         # Sub-módulo de demurrage (containers/invoices/rates/kpis)
    __tests__/         # Testes unitários + fixtures
  lib/                 # Utilitários sem UI: pix, containerCounts, utils, fileGuard
  config/              # Constantes (company.ts)
  types/               # database.ts (GERADO — não editar) + tipos de domínio
  integration/         # Testes de integração opt-in (Supabase real)

supabase/
  migrations/          # 90+ migrations sequenciais (schema + RLS + RPCs)
  functions/           # Edge Functions (Deno)
  scripts/             # reset_operational_data.sql
  seeds/               # validation_seed.sql
  config.toml          # Config do Supabase CLI

public/
  templates/           # Modelos de importação (csv/xlsx) servidos ao usuário
  branding/            # Logos

docs/                  # ARCHITECTURE, ROADMAP, VALIDACAO, RESET_AMBIENTE
.github/workflows/     # firebase-deploy.yml, auto-merge-prs.yml
```

---

## 4. Módulos e responsabilidades

### Operação
| Rota | Página | Responsabilidade |
|---|---|---|
| `/painel` | Painel | Dashboard com contadores operacionais |
| `/viagens` | Viagens | CRUD de viagens, agendas POL/POD/export, stats |
| `/baplie` | Baplie | Import de baplie EDI (staging + conciliação) |
| `/manifestos` · `/manifestos/:blId` | Manifestos · BlDetalhe | Import CNTR; detalhe/edição de B/L |
| `/carga-solta` | CargaSolta | Import de manifesto break-bulk (BB) |
| `/containers` | Containers | Listagem/exportação de containers |
| `/veiculos` | Veiculos | Listagem de veículos (RoRo) |
| `/vazios-importacao` | VaziosImportacao | Containers vazios de importação |
| `/embarquevazios` | EmbarqueVazios | Bookings de embarque de vazios |
| `/revisao` | Revisao | Fila de revisão manual de B/Ls |
| `/granito` · `/granito/taxas` | Granite · GraniteRates | Import COSCO + tarifas de granito |

### Financeiro / Comercial
| Rota | Página | Responsabilidade |
|---|---|---|
| `/clientes` · `/clientes/:cnpj` | Clientes · ClienteFicha | CRUD + ficha + provisão de portal |
| `/taxas-locais` | TaxasLocais | Tabelas de taxas + overrides por cliente |
| `/faturamento` | Faturamento | Emissão/gestão de invoices + ledger |
| `/demurrage` · `/demurrage/taxas` | Demurrage · DemurrageRates | Cálculo/invoices + tarifas |
| `/reconciliacao` | Reconciliacao | Conciliação PIX (unificada) |
| `/relatorios` | Relatorios | Exportações consolidadas |

### Suporte / Admin / Portal
| Rota | Página | Responsabilidade |
|---|---|---|
| `/alertas` | Alertas | Alertas operacionais e financeiros |
| `/line-up-tv` · `/line-up-tv/display` | LineUpTV · LineUpTVDisplay | Painel para TV |
| `/admin/usuarios` | AdminUsuarios | Gestão de usuários internos (admin) |
| `/portal/login` · `/portal/billing` | PortalLogin · PortalBilling | Portal do cliente |

---

## 5. Banco de dados e relacionamentos

~50 tabelas. Núcleo do modelo:

```
carriers ──< vessels ──< voyages ──< bls ──< bl_containers
                                       │        └──< vehicles (FK bl_id, bl_container_id)
                                       ├──< bl_breakbulk_items
                                       ├──< charge_calculations ──> charge_tables ──< charge_table_items
                                       └──< invoice_bls / invoice_receivable_links ──> invoices ──< payments
customers ──< customer_contacts
          ──< customer_portal_accounts ──< customer_portal_sessions
          ──< customer_rate_overrides
          ──< customer_reconciliation_queue

# Granito (paralelo, parser COSCO):
granite_manifests ──< granite_bls ──< granite_bl_charges ; granite_rates
invoices ──< invoice_granite_bls

# Demurrage (sobre containers):
demurrage_rates ; demurrage_invoices ──< demurrage_invoice_items

# Vazios:
vazios_manifests / vazios_bookings (export)
vazios_importacao_manifests ──< vazios_importacao_containers (import)
baplie_containers (staging EDI)

# Faturamento consolidado / ledger:
bl_receivables ──< invoice_receivable_links ; ledger_settlements ;
invoice_counters ; invoice_lifecycle_events ; billing_runs ──< billing_run_logs

# Suporte:
user_profiles (role: administrativo|financeiro|operacoes|documentacao)
audit_logs ; alerts ; ports ; import_batches ──< import_errors
portal_login_attempts ; provision_rate_limit_log ; pricing_rule_versions
```

**Conceitos-chave:**
- **B/L unificado** vive em duas tabelas: `bls` (`cargo_mode='container'|
  'carga_solta'`) e `granite_bls`. Revisão, Taxas Locais, Faturamento e PIX
  tratam ambas no mesmo fluxo.
- **Invoices** cobrem Container, Break-bulk e Granito (tabela `invoices`);
  Demurrage tem tabela própria (`demurrage_invoices`). O Faturamento e o Portal
  agregam ambas.
- **RLS** ativa em todas as tabelas. Helpers: `is_admin()`, `is_active_user()`,
  `current_user_role()`. Tabelas financeiras: leitura por usuário ativo,
  escrita restrita a admin (ver migrations 014, 042, 053).

---

## 6. APIs e integrações

### Internas (Supabase RPCs — ~70 funções `SECURITY DEFINER`)
Exemplos críticos:
- `import_manifest_transactional` — import atômico de manifesto.
- `create_invoice_from_bls` / `create_local_consolidated_invoice` /
  `create_invoice_from_granite_bls` — emissão de faturas.
- `assign_invoice_number` — numeração sequencial (`invoice_counters`).
- `build_transshipping_pix_payload`, `pix_crc`, `pix_tlv` — geração PIX no banco.
- `portal_login`, `portal_list_invoices`, `portal_get_session_overview` — portal.
- `check_provision_rate_limit` — rate limit persistido para provisão de portal.
- `mark_overdue_invoices` / `detect_overdue_invoices` — enforcement de atraso.

### Edge Functions (Deno)
- **`provision-portal-user`** — cria/atualiza usuário Supabase Auth do portal.
  Exige caller admin ativo; rate-limited (20/h via RPC); CORS restrito a `APP_URL`.
- **`notify-invoice-issued`** — disparada por Database Webhook quando
  `invoices.status → 'issued'`. Autenticação por bearer service-role
  (comparação *timing-safe*); re-busca a fatura do banco; HTML escapado; envia
  email via Resend.

### Integrações externas
| Serviço | Uso | Onde |
|---|---|---|
| **Resend** | Email de fatura emitida | Edge Function `notify-invoice-issued` |
| **Banco Central (olinda.bcb.gov.br)** | Cotação ROE (taxa de câmbio) | `useExchangeRates` |
| **PIX** | Payload de pagamento (`src/lib/pix.ts` + RPC no banco) | Faturas |
| **Firebase Hosting** | Hospedagem da SPA | CI/CD |

---

## 7. Fluxos detalhados do sistema

### Fluxo operacional típico (usuário interno)
```
1. Cadastrar viagem (/viagens)
2. Importar dados da carga:
   • Manifesto CNTR (/manifestos) ou BB (/carga-solta)
   • Baplie EDI (/baplie) → concilia com manifesto + alimenta vazios import
   • Granito: planilha COSCO (/granito)
   • Veículos: planilha própria (/veiculos)
   • Vazios: chegadas (/vazios-importacao) e bookings (/embarquevazios)
3. Revisar pendências de B/L (/revisao) → aprovar
4. Calcular taxas locais (/taxas-locais) → marcar pronto p/ faturar
5. Emitir invoices (/faturamento) e/ou demurrage (/demurrage)
6. Registrar pagamentos e conciliar PIX (/reconciliacao)
7. (automático) Webhook dispara email ao cliente
8. Cliente consulta o portal (/portal/billing)
```

### Fluxo administrativo
- **Gestão de usuários** (`/admin/usuarios`, role admin): cria perfil em
  `user_profiles` com `role` e `active`.
- **Provisão de acesso ao portal** (`ClienteFicha` → Edge Function): admin
  gera credenciais Supabase Auth para o cliente.

### Jobs / processos automatizados
- **Overdue enforcement**: `mark_overdue_invoices` / `detect_overdue_invoices`
  (migrations 024, 031) marcam faturas vencidas e bloqueiam novas emissões para
  clientes inadimplentes (`fn_block_invoice_overdue_customer`).
- **Snapshot de agenda de viagem**: trigger `voyage_schedule_snapshot` (046, 052).

### Webhooks
- **Database Webhook** `invoices UPDATE (status → issued)` →
  `notify-invoice-issued` → email Resend.

### Autenticação (duas fronteiras)
- **Interna** (`useAuth`): Supabase Auth + perfil em `user_profiles`; timeout de
  inatividade de 8h; role → permissões via `roleHasPermission`.
- **Portal** (`usePortalAuth`): Supabase Auth (preferencial) + fallback de token
  legacy em `sessionStorage`; rate limit `portal_login` (10/15min por CNPJ).

---

## 8. Como executar localmente

```bash
# 1. Dependências (o repo usa peer deps que exigem --legacy-peer-deps)
npm ci --legacy-peer-deps

# 2. Variáveis de ambiente
cp .env.example .env
# Preencher:
#   VITE_SUPABASE_URL=https://<projeto>.supabase.co
#   VITE_SUPABASE_ANON_KEY=<anon key>

# 3. Banco: aplicar TODAS as migrations em ordem no SQL Editor do Supabase
#    supabase/migrations/001_*.sql  →  (timestamp mais recente)

# 4. Provisionar um usuário interno (após criá-lo no Supabase Auth):
#    INSERT INTO public.user_profiles (id, role, active)
#    VALUES ('<auth-user-uuid>', 'administrativo', true);

# 5. Rodar
npm run dev          # http://localhost:5173
```

Sem `VITE_SUPABASE_*` a aplicação loga erro e o cliente Supabase fica vazio.

---

## 9. Como testar

```bash
npm test                    # Vitest (unitários) — rápido, sem rede
npm run test:integration    # Integração contra Supabase REAL (opt-in)
npm run lint                # ESLint (flat config)
npm run build               # tsc -b + vite build (verificação de tipos + bundle)
```

- **Unitários** ficam em `src/**/__tests__/*.test.ts` e `src/pages/__tests__/`.
  Cobrem parsers de import, taxas locais, reconciliação, reports, migrations de
  ledger e os componentes de fatura.
- **Integração** (`src/integration/supabase.integration.test.ts`) só roda com
  `SUPABASE_RUN_INTEGRATION=1` e credenciais extras no `.env`. **Nunca** rodar em
  CI sem ambiente isolado.

**Critério de "verde" antes de PR:** `npm run build` + `npm test` sem erros;
`npm run lint` sem novos warnings.

---

## 10. Como realizar deploy

Totalmente automatizado via **GitHub Actions** → **Firebase Hosting** (projeto
`importmanager-bda3e`, target `transhippingdesk`). Nenhum push manual.

- **`auto-merge-prs.yml`** (padrão): todo PR aberto/reaberto é mergeado (squash)
  via API, faz `npm ci --legacy-peer-deps` + `npm run build` (injeta
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_COMMIT_SHA`) e
  publica no Firebase.
- **`firebase-deploy.yml`**: cobre push direto em `main` (hotfix).
- **Manual** (emergência): `npm run build && npx firebase-tools deploy --only hosting`.

**Secrets do repositório:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`FIREBASE_SERVICE_ACCOUNT_IMPORTMANAGER_BDA3E`.

**Migrations** NÃO são aplicadas pelo CI — aplicar manualmente no Supabase antes
de fazer deploy de código que dependa delas.

---

## 11. Como adicionar funcionalidades

### Nova página + rota
1. Criar `src/pages/MinhaPagina.tsx` com **export nomeado**
   (`export function MinhaPagina() {}`) — sem default export.
2. Registrar em `src/App.tsx`: `const MinhaPagina = lazyPage(() =>
   import('./pages/MinhaPagina'), 'MinhaPagina')` e adicionar a `<Route>` dentro
   do guard apropriado (`ProtectedRoute`, `ProtectedRoute adminOnly`, ou
   `PortalProtectedRoute`).
3. Adicionar item de navegação no `AppLayout` se aplicável.

### Novo acesso a dados (padrão service + hook)
1. **Service** (`src/services/xxx.ts`): função pura que importa `supabase`,
   executa a query e **lança** em erro (`if (error) throw error`). Escapar
   qualquer input de usuário em `.or()/.ilike()` com `escapeFilterTerm`
   (`src/lib/utils.ts`).
2. **Hook** (`src/hooks/useXxx.ts`): `useQuery`/`useMutation`, chave de cache
   vinda de `src/services/queryKeys.ts`, e `invalidateQueries` das chaves
   dependentes nas mutations.
3. Consumir o hook na página.

### Novo parser de importação
Seguir o playbook em `.claude/skills/import-parser.skill`. Adicionar fixtures de
regressão em `src/services/__tests__/`. Validar tamanho de upload com
`assertUploadSize` (`src/lib/fileGuard.ts`).

### Mudança de schema (migration)
Seguir `.claude/skills/supabase-migration.skill`: nome com timestamp, RLS-first,
nota de rollback. **Não** editar `src/types/database.ts` à mão — regenerar via
Supabase CLI. **Nunca** afrouxar RLS sem revisão de segurança.

### Novo documento de fatura (PDF)
Seguir `.claude/skills/invoice-pdf.skill` para manter layout/fontes/dados
fiscais/bloco PIX consistentes. `jspdf` deve ser importado dinamicamente.

---

## 12. Como criar componentes, rotas e integrações

- **Componentes UI** (`src/components/ui/`): apenas apresentação, sem lógica de
  domínio. Reutilizar `Button`, `Input/Field`, `Modal`, `Badge`, `Card`,
  `Toast`, `ConfirmDialog`, `Combobox`, `Skeleton`. Estilo via classes Tailwind
  + tokens CSS (`--app-border`, `--app-surface`, etc.) de `src/index.css`.
- **Componentes de domínio compartilhados**: `src/components/shared/`.
- **Rotas**: ver §11. Lembrar do guard correto; rotas internas dependem de RLS
  para autorização real (o roteamento só força `adminOnly`).
- **Integrações externas**: domínios precisam estar na **CSP** do
  `firebase.json` (`connect-src`). Hoje liberados: `*.supabase.co`,
  `olinda.bcb.gov.br`, `api.resend.com`. Segredos de servidor ficam **apenas**
  em Edge Functions (env vars), nunca no bundle do cliente.

---

## 13. Boas práticas do projeto

- **Pense antes de codar**: declarar premissas, expor tradeoffs, perguntar
  quando ambíguo (ver `CLAUDE.md`).
- **Simplicidade e mudanças cirúrgicas**: tocar só o necessário; não refatorar o
  que não está quebrado; manter o estilo existente.
- **Segurança no banco**: a checagem no cliente é UX; a fronteira é RLS + RPC.
  Escapar todo input de usuário em filtros PostgREST.
- **Erros em services**: lançar (`throw`), não silenciar. Mutations exibem erro
  via `Toast`.
- **Cache**: chaves centralizadas em `queryKeys.ts`; invalidar com precisão.
- **Bundle**: páginas lazy; libs pesadas (`xlsx`, `jspdf`) com `await import()`.
- **Exportações de planilha**: usar o sanitizador de `exports.ts` (neutraliza
  injeção de fórmula em dados importados não confiáveis).
- **Tipos gerados**: `src/types/database.ts` é gerado — não editar à mão.

---

## 14. Riscos conhecidos e melhorias futuras

Estado operacional e backlog em `docs/ROADMAP.md`; fluxo canônico em `docs/ARCHITECTURE.md`.

**Riscos conhecidos**
- Parser de manifesto sensível a novos layouts de armador (mitigado por fixtures
  de regressão).
- Cobertura de testes ainda parcial em fluxos end-to-end de faturamento, portal e autenticação.
- Dependência `xlsx` (SheetJS) com vulnerabilidade conhecida sem correção no
  registro npm — usar entrada não confiável apenas em parsing controlado.
- Algumas escritas best-effort (alertas, eventos operacionais, PIX payload)
  logam e seguem em vez de falhar — por design, mas pode mascarar falhas.

**Melhorias futuras**
- Continuar a decomposição das páginas grandes em componentes menores e testáveis.
- Adicionar testes end-to-end para billing, demurrage, autenticação e portal.
- Camadas adicionais de autenticação forte no portal (ver ROADMAP).
```
