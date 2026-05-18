# Transhipping Desk

Plataforma operacional interna para **Transhipping Agenciamento Marítimo Ltda.** — gestão de viagens, manifestos, faturamento, demurrage e portal do cliente.

**Stack:** React 19 + TypeScript + Vite · Supabase (PostgreSQL + Auth + Edge Functions) · Firebase Hosting · CI/CD via GitHub Actions

---

## Módulos

### Operação
| Rota | Descrição |
|------|-----------|
| `/painel` | Dashboard com contadores operacionais |
| `/viagens` | Cadastro e gestão de viagens |
| `/manifestos` | Importação de manifestos CNTR |
| `/carga-solta` | Importação de manifestos breakbulk (BB) |
| `/containers` | Listagem de containers |
| `/veiculos` | Listagem de veículos (módulo RoRo) |
| `/revisao` | Fila de revisão manual de B/Ls |
| `/line-up-tv` · `/line-up-tv/display` | Painel de line-up em TV |

### Comercial / Financeiro
| Rota | Descrição |
|------|-----------|
| `/clientes` · `/clientes/:id` | Cadastro de clientes e ficha completa |
| `/taxas-locais` | Tabelas de tarifas e overrides por cliente |
| `/faturamento` | Emissão e gestão de invoices |
| `/demurrage` · `/demurrage/taxas` | Cálculo e invoices de demurrage |
| `/reconciliacao` | Conciliação PIX / pagamentos |
| `/relatorios` | Exportações e relatórios consolidados |

### Módulo Granito
| Rota | Descrição |
|------|-----------|
| `/granito` | Importação de planilha COSCO e faturamento |
| `/granito/taxas` | Tabela de taxas específica de granito |

### Módulo Vazios
| Rota | Descrição |
|------|-----------|
| `/vazios-importacao` | Containers vazios de importação |
| `/embarquevazios` | Bookings de embarque de vazios (`/vazios` redireciona aqui) |

### Portal do Cliente
| Rota | Descrição |
|------|-----------|
| `/portal/login` | Autenticação por CNPJ/CPF + senha |
| `/portal/billing` | Visualização de invoices e saldo em aberto |

### Administração
| Rota | Descrição |
|------|-----------|
| `/alertas` | Central de alertas operacionais e financeiros |
| `/admin/usuarios` | Gestão de usuários internos (perfil `administrativo`) |

---

## Fluxo Operacional Típico

```
1. Cadastrar viagem (/viagens)
2. Importar manifesto CNTR (/manifestos) ou BB (/carga-solta)
   └─ Granito: importar planilha COSCO (/granito)
   └─ Vazios: importar chegadas (/vazios-importacao) e bookings (/embarquevazios)
3. Revisar pendências (/revisao)
4. Calcular taxas locais (/taxas-locais)
5. Emitir invoices (/faturamento ou /demurrage)
6. Registrar pagamentos e conciliar PIX (/reconciliacao)
7. Cliente consulta portal (/portal/billing)
```

---

## Configuração Local

### 1. Pré-requisitos

- Node.js 20+
- Projeto Supabase com migrations aplicadas

### 2. Variáveis de ambiente

```bash
cp .env.example .env
```

Preencha no `.env`:

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anon
```

As demais variáveis (`SUPABASE_*`) são usadas apenas nos testes de integração.

### 3. Banco de dados

Aplique todas as migrations em ordem no **SQL Editor** do Supabase:

```
supabase/migrations/001_schema.sql  →  053_security_hardening.sql
```

### 4. Usuários internos

No **Supabase Auth**, crie o usuário e insira o perfil:

```sql
INSERT INTO public.user_profiles (id, role, active)
VALUES ('<auth-user-uuid>', 'administrativo', true);
```

Roles disponíveis: `administrativo` · `financeiro` · `operacoes` · `documentacao`

### 5. Edge Functions (opcional para desenvolvimento local)

Variáveis necessárias nas Edge Functions do Supabase:

| Variável | Descrição |
|----------|-----------|
| `RESEND_API_KEY` | Chave de API Resend (envio de email de invoice) |
| `FROM_EMAIL` | Remetente (ex: `Transhipping <noreply@...>`) |
| `PORTAL_URL` | URL base do portal do cliente |
| `APP_URL` | URL do app (restrição de CORS em `provision-portal-user`) |

---

## Scripts

```bash
npm run dev          # servidor de desenvolvimento
npm run build        # build de produção (TypeScript + Vite)
npm run lint         # ESLint
npm test             # testes unitários (Vitest)
npm run test:integration  # testes de integração com Supabase real
```

Os testes de integração requerem `SUPABASE_RUN_INTEGRATION=1` e as variáveis `SUPABASE_*` no `.env`.

---

## Templates de Importação

Disponíveis em `public/templates/` e servidos diretamente pelo app:

| Arquivo | Módulo |
|---------|--------|
| `base-clientes-modelo.csv/.xlsx` | Importação de clientes |
| `ce-mercante-modelo.csv/.xlsx` | CE Mercante (vinculação de B/Ls) |
| `carga-solta-modelo.csv/.xlsx` | Manifesto breakbulk |
| `veiculos-modelo.csv/.xlsx` | Importação de veículos (RoRo) |
| `imo-oog-modelo.csv/.xlsx` | Cargas IMO / OOG |

---

## Deploy

Deploy automático via **GitHub Actions** em todo push para `main`.

Pipeline (`.github/workflows/firebase-deploy.yml`):
1. Checkout + setup Node 20
2. `npm ci` + `npm run build` (injeta `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` dos secrets)
3. Deploy para **Firebase Hosting** (projeto `importmanager-bda3e`, target `transhippingdesk`)

Para deploy manual:

```bash
npm run build
npx firebase-tools deploy --only hosting
```

**Secrets necessários no repositório:**
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `FIREBASE_SERVICE_ACCOUNT_IMPORTMANAGER_BDA3E`

---

## Segurança

- **RLS** ativo em todas as tabelas; acesso segmentado por role via `is_admin()` / `is_active_user()`
- **Portal do cliente:** autenticação via Supabase Auth (preferencial) com fallback legacy token
- **Rate limiting:** `portal_login` (10 tentativas / 15 min por CNPJ) e `provision-portal-user` (20/hora por usuário, persistido em banco)
- **Timeout de sessão interna:** 8 horas de inatividade
- **Headers HTTP:** `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, `CSP` sem `unsafe-inline` em scripts
- **Email:** campos de BD escapados antes de injeção em HTML

---

## Documentação Interna

| Arquivo | Conteúdo |
|---------|----------|
| `docs/ROADMAP.md` | Estado atual e backlog priorizado |
| `docs/VALIDACAO.md` | Roteiro de validação por módulo |
| `docs/RESET_AMBIENTE.md` | Procedimento de reset de dados de teste |
| `docs/PLANEJAMENTO_GRANITO_VAZIOS.md` | Planejamento técnico dos módulos Granito e Vazios |
| `CLAUDE.md` / `AGENTS.md` | Diretrizes de desenvolvimento assistido por IA |

---

## Estrutura do Projeto

```
src/
├── components/       # UI e layout compartilhados
├── hooks/            # useAuth, usePortalAuth, hooks de dados
├── pages/            # Uma página por rota
├── services/         # Acesso a Supabase e lógica de domínio
│   └── __tests__/    # Testes unitários + fixtures
├── lib/              # Utilitários (pix, containerCounts, utils)
├── types/            # Tipos gerados do banco (database.ts)
└── config/           # Configurações estáticas (company.ts)

supabase/
├── migrations/       # 053 migrations em ordem sequencial
├── functions/        # Edge Functions (notify-invoice-issued, provision-portal-user)
├── scripts/          # Scripts utilitários (reset de dados)
└── seeds/            # Seed de validação
```
