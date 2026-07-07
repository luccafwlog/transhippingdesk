# Transhipping Desk

Plataforma operacional interna da **Transhipping Agenciamento Marítimo Ltda.** — gestão de viagens, manifestos, faturamento, demurrage e portal do cliente. Em **produção**.

**Stack:** React 19 + TypeScript + Vite · Supabase (PostgreSQL + Auth + Edge Functions) · Firebase Hosting · CI/CD via GitHub Actions.

## Capacidades

- **Operação:** viagens, escalas, Baplie EDI, manifestos CNTR e breakbulk,
  containers, veículos RoRo e revisão operacional.
- **Exportação e cargas especiais:** Granito, vazios de importação e bookings de
  vazios de exportação.
- **Comercial e financeiro:** clientes, tabelas de taxas, invoices, ledger
  local, demurrage, PIX, alertas e relatórios.
- **Portal do Cliente:** painel, faturas, B/Ls, containers, notificações,
  disputas, perfil e recuperação de senha.
- **Suporte operacional:** Line Up TV, programação de chegadas e saídas e
  administração de usuários internos.

O mapa completo de módulos, rotas e fluxos está em
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Início rápido

### Pré-requisitos

- Node.js 20 ou superior;
- projeto Supabase compatível com as migrations do repositório;
- usuário interno criado no Supabase Auth e vinculado a `user_profiles`.

### Instalação

```powershell
npm ci --legacy-peer-deps
Copy-Item .env.example .env
npm run dev
```

Preencha ao menos:

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-publica
```

Sem essas variáveis, a aplicação mostra um erro de configuração e não inicia o
cliente de dados.

### Banco de dados

Não aplique um intervalo fixo de arquivos manualmente. O diretório usa um único
esquema de nome: numerado sequencial de três dígitos (`001_…` em diante; ver
ADR 0016). Compare o histórico remoto com `supabase/migrations/` e aplique todas
as pendentes por um fluxo controlado do Supabase. O CI da SPA não aplica migrations.

Consulte [`WORKFLOW.md`](./WORKFLOW.md) antes de alterar schema, RLS, funções ou
grants.

### Usuário interno

Depois de criar o usuário no Supabase Auth:

```sql
INSERT INTO public.user_profiles (id, role, active)
VALUES ('<auth-user-uuid>', 'administrativo', true);
```

Perfis atuais: `administrativo`, `financeiro`, `operacoes` e `documentacao`.
A autorização real é aplicada no banco por RLS e RPCs; esconder uma rota ou
botão no navegador é apenas uma barreira de UX.

## Comandos

```powershell
npm run dev               # servidor Vite
npm run docs:check        # links, ADRs, rotas e afirmações obsoletas
npm run lint              # ESLint
npm test                  # Vitest
npm run build             # TypeScript + bundle de produção
npm run test:integration  # Supabase real; opt-in por variáveis de ambiente
```

Os testes de integração exigem `SUPABASE_RUN_INTEGRATION=1` e as variáveis
`SUPABASE_*` de [`.env.example`](./.env.example). Use somente um ambiente
controlado.

## Portal do Cliente

O Portal usa uma sessão própria do Supabase Auth, isolada da sessão interna do
mesmo navegador. A tela aceita **CNPJ, CPF ou email** como identificador; CNPJ e
CPF são resolvidos para o email técnico antes de `signInWithPassword`.

Não existe cadastro público nem sessão legada por senha armazenada em tabela.
O acesso é provisionado internamente a partir da ficha do cliente. A decisão de
segurança está registrada na
[ADR 0013](./docs/adr/0013-portal-auth-identificador-resolvido-e-excecao-anon.md).

## Templates de importação

Os modelos públicos ficam em [`public/templates/`](./public/templates/) e são
servidos pela aplicação:

- base de clientes;
- CE Mercante;
- carga solta;
- veículos;
- cargas IMO/OOG.

Fixtures técnicas para o fluxo E2E ficam em
[`test-fixtures/`](./test-fixtures/README.md).

## CI e deploy

O fluxo atual é:

```text
pull_request
  -> CI: documentação, lint, build e testes

push em main
  -> CI + build + Firebase Hosting
  -> Firebase Hosting
```

Os workflows vivem em [`.github/workflows/`](./.github/workflows/). Migrations e
Edge Functions continuam exigindo coordenação com o ambiente Supabase; o deploy
do frontend não as aplica.

## Segurança operacional

- RLS e RPCs são a fronteira de autorização.
- Funções privilegiadas seguem default-deny, com exceções pré-login explícitas
  e documentadas.
- O Portal e o app interno usam clientes Supabase com chaves de storage
  distintas.
- Erros de produção são enviados ao Sentry sem replay ou PII padrão.
- Uploads de planilha têm limite antes do parsing.
- Invoices são documentos React preparados para impressão pelo navegador.
- O reset operacional amplo está suspenso; consulte
  [`docs/operations/reset-ambiente.md`](./docs/operations/reset-ambiente.md).

## Documentação

A documentação completa vive em **[`docs/`](docs/README.md)**. Atalhos:

- **[Índice](docs/README.md)** — ponto de entrada e mapa de módulos.
- **[Arquitetura](docs/ARCHITECTURE.md)** — stack, camadas, modelo de dados, mapa de rotas.
- **[CONTEXT.md](CONTEXT.md)** — termos de domínio (B/L, Baplie, CE Mercante, demurrage…).
- **[Módulos](docs/README.md#módulos)** — Faturamento, Viagens, Granito, Manifestos/EDI, Portal, Demurrage, etc.
- **[Setup](docs/setup/development.md)** · **[Deploy](docs/setup/deploy.md)** · **[Testes](docs/setup/testing.md)**
- **[Regras de negócio](docs/operations/regras-de-negocio.md)** · **[Segurança](docs/operations/seguranca.md)**
- **[Roadmap](docs/ROADMAP.md)** · **[ADRs](docs/adr/)** · **[Changelog](docs/CHANGELOG.md)**

## Diretrizes de desenvolvimento

Comportamento de desenvolvimento assistido por IA: **[CLAUDE.md](CLAUDE.md)**. Convenções específicas (parsers, migrations, invoices, React Query) estão nas skills em `.claude/skills/`.
