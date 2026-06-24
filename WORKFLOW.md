# WORKFLOW.md — Transhipping Desk

Manual vivo para desenvolver, testar, migrar e publicar o Transhipping Desk.
Verificado contra o repositório em 2026-06-24.

Use este documento para procedimentos técnicos. Consulte:

- [`CONTEXT.md`](./CONTEXT.md) para linguagem de domínio;
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) para fluxos e rotas;
- [`docs/adr/README.md`](./docs/adr/README.md) para decisões;
- [`docs/operations/validacao.md`](./docs/operations/validacao.md) para testes operacionais;
- [`docs/CONVENCOES.md`](./docs/CONVENCOES.md) para estilo e labels de evidência;
- [`docs/README.md`](./docs/README.md) para a hierarquia documental.

Código, migrations e configuração executável são a evidência final quando um
snapshot histórico diverge do estado atual.

## 1. Stack verificada

### Frontend

- React 19 e React DOM;
- TypeScript;
- Vite;
- Tailwind CSS via plugin Vite;
- React Router;
- TanStack Query;
- Zod;
- Vitest e Testing Library;
- `@e965/xlsx` para leitura e escrita de planilhas;
- `qrcode.react` para QR PIX;
- `@sentry/react` para telemetria de produção.

As versões exatas vivem em `package.json` e `package-lock.json`; não as duplique
em documentação.

### Backend e infraestrutura

- Supabase PostgreSQL, Auth, RLS e RPCs;
- Edge Functions Deno;
- Resend para email;
- Firebase Hosting;
- GitHub Actions para CI e deploy.

## 2. Arquitetura de execução

```text
Browser
  ├─ sessão interna: supabase
  └─ sessão do Portal: supabasePortal (storage isolado)
       ↓
Supabase
  ├─ PostgreSQL + RLS
  ├─ RPCs transacionais
  ├─ Auth
  └─ Edge Functions
```

Os clientes ficam em `src/services/supabase.ts`.

### Sessão interna

O usuário autentica pelo Supabase Auth e precisa de perfil ativo em
`user_profiles`. `ProtectedRoute` melhora a navegação, mas não é a fronteira de
segurança. Policies e funções do banco precisam continuar corretas mesmo para
uma chamada direta à API.

### Sessão do Portal

O Portal usa Supabase Auth com cliente e chave de storage próprios. A tela aceita
CNPJ, CPF ou email. Documentos são resolvidos para o email técnico por
`portal_resolve_login(text)` antes de `signInWithPassword`.

Não existe sessão alternativa por senha armazenada em tabela. A exceção
pré-autenticação para o resolver está documentada na
[ADR 0013](./docs/adr/0013-portal-auth-identificador-resolvido-e-excecao-anon.md).

## 3. Estrutura do repositório

```text
src/
  App.tsx                 mapa de rotas
  main.tsx                providers globais e telemetria
  pages/                  composição de telas
  hooks/                  queries e mutations reutilizáveis
  services/               Supabase, parsers, imports e domínio
  components/
    ui/                   primitivas visuais
    layout/               shells e guards
    shared/               componentes entre módulos
    billing/              faturamento
    demurrage/            demurrage
  lib/                    utilitários puros
  types/database.ts       tipos gerados e complementos

scripts/
  check-docs.mjs          verificação de documentação (`npm run docs:check`)
  perf/                   harness de orçamento de carga das rotas
  design-audit/           bootstrap e seed da auditoria de design

supabase/
  migrations/             história do schema
  functions/              Edge Functions
  scripts/                scripts operacionais
  seeds/                  dados de validação

public/
  templates/              modelos baixados pelo usuário
  branding/               imagens públicas

docs/
  README.md               mapa documental
  ARCHITECTURE.md         arquitetura atual
  ROADMAP.md              baseline, evolução e riscos
  CONTEXT.md              glossário de domínio
  adr/                    decisões arquiteturais
  operations/             regras, validação, segurança e reset
  setup/                  desenvolvimento, testes e deploy
  modules/                documentação por módulo
  CONVENCOES.md           convenções de documentação
  behavioral-spec/        matriz de verificação comportamental
  superpowers/            planos e specs (vivos e archive)
  archive/                snapshots históricos
```

Para obter contagens atuais, derive-as do repositório. Exemplo:

```powershell
(Get-ChildItem supabase/migrations -File -Filter *.sql).Count
```

## 4. Preparação local

### Dependências

```powershell
npm ci --legacy-peer-deps
```

Use `npm ci` para reproduzir o lockfile. Alterações intencionais de dependência
devem atualizar `package.json` e `package-lock.json` juntas.

### Ambiente

```powershell
Copy-Item .env.example .env
```

Variáveis obrigatórias para o app:

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-publica
```

As variáveis `SUPABASE_*` adicionais são usadas pela suíte de integração. Não
coloque service role no bundle Vite.

### Execução

```powershell
npm run dev
```

O Vite usa a porta padrão local. O proxy `/sb-proxy` existe apenas para a
auditoria de design com Supabase local.

## 5. Migrations Supabase

O diretório mistura:

- migrations históricas com prefixos sequenciais;
- migrations atuais com timestamp UTC.

Não renomeie arquivos já aplicados para “organizar” a pasta. O nome participa do
histórico remoto.

### Antes de criar

1. declare o problema de negócio;
2. identifique todas as tabelas, funções e policies afetadas;
3. leia as migrations recentes e o schema real;
4. confira os ADRs de segurança e domínio relevantes;
5. defina rollback ou reversão operacional.

Use o playbook `.claude/skills/supabase-migration.skill`.

### Nome de arquivo novo

```text
YYYYMMDDHHMMSS_descricao_curta.sql
```

Use timestamp UTC para evitar colisões entre branches.

### Segurança

- tabelas novas precisam de RLS ou revogação explícita para uso servidor;
- funções `SECURITY DEFINER` precisam de `search_path` controlado;
- revogue `PUBLIC` e `anon` no mesmo arquivo por padrão;
- grants pré-autenticação para `anon` exigem decisão explícita, controles contra
  abuso e teste focado;
- trigger functions não precisam ser executáveis diretamente por clientes.

### Tipos

Regere `src/types/database.ts` quando o contrato usado pelo app mudar. Não edite
tipos gerados manualmente para esconder drift.

### Aplicação

O CI da SPA não aplica migrations. Antes de publicar frontend dependente:

1. compare `supabase/migrations/` com o histórico do ambiente;
2. aplique todas as pendentes por fluxo controlado;
3. verifique advisors e contrato;
4. só então publique o código dependente.

Nunca execute um reset amplo para “testar” uma migration. O reset operacional
atual está suspenso em
[`docs/operations/reset-ambiente.md`](./docs/operations/reset-ambiente.md).

## 6. Acesso a dados e React Query

### Serviços

Serviços em `src/services/` são os donos preferenciais de:

- chamadas Supabase reutilizáveis;
- regras de domínio;
- parsing e importação;
- exportações;
- normalização de respostas;
- erros de operação.

Uma função de serviço deve retornar dados úteis ou lançar o erro. Não transforme
falha real em sucesso vazio.

### Hooks

Hooks em `src/hooks/` são preferidos quando há:

- estado remoto reutilizado;
- loading/error/refetch compartilhado;
- cache;
- mutation com invalidação;
- consumo por mais de uma tela ou componente.

Use chaves de `src/services/queryKeys.ts` quando já existir uma família para o
domínio. Confira a forma exata do prefixo: acrescentar `undefined` pode impedir
uma invalidação por prefixo.

### Chamadas diretas por páginas

O código atual também chama serviços diretamente em páginas para comandos
pontuais, como importação, exportação, impressão e ações de baixa frequência.
Isso é aceitável quando corresponde ao padrão local e não duplica estado remoto.

Não crie uma chamada Supabase direta numa página se um serviço ou hook já é o
dono daquela operação.

### Supabase direto

Há fluxos legados que importam `supabase` diretamente. Ao tocar neles:

1. preserve a mudança cirúrgica;
2. extraia serviço/hook apenas quando isso reduzir duplicação ou permitir teste;
3. não faça uma migração arquitetural ampla sem plano próprio.

## 7. Importações e planilhas

Use `.claude/skills/import-parser.skill`.

Regras mínimas:

1. inspecionar arquivo real;
2. validar tamanho com `assertUploadSize` antes de `arrayBuffer()` ou parsing;
3. importar planilhas por `await import('@e965/xlsx')` quando possível;
4. manter parser puro separado da persistência;
5. adicionar fixture e teste de regressão;
6. usar RPC quando múltiplas escritas precisarem ser atômicas;
7. exibir preview e resumo de erros antes da confirmação;
8. validar duplicidade ou idempotência.

Parsers existentes são referências, não contratos universais:

- `manifestParser.ts` e `manifestImport.ts`: manifesto CNTR;
- `breakbulkImport.ts`: carga solta;
- `baplieParser.ts` e `baplieImport.ts`: EDI e staging;
- `vehicleImport.ts`: veículos;
- `ceMercanteImport.ts`: CE;
- `containerDatesImport.ts`: datas;
- `customerBase.ts`: clientes.

## 8. Rotas e páginas

`src/App.tsx` é a fonte executável das rotas.

### Nova rota

1. crie uma página com export nomeado;
2. carregue-a por `lazyPage`;
3. coloque-a sob o guard apropriado;
4. adicione navegação, se aplicável;
5. atualize `docs/ARCHITECTURE.md`;
6. execute `npm run docs:check`.

Rotas do Portal ficam sob `PortalProtectedRoute` e `PortalLayout`. Rotas internas
ficam sob `ProtectedRoute` e `AppLayout`. Administração de usuários usa
`adminOnly`.

## 9. Componentes e interface

- reutilize componentes de `src/components/ui/`;
- use tokens CSS de `src/index.css`;
- mantenha lógica de domínio fora de primitivas visuais;
- preserve estados de loading, vazio, erro e feedback de mutation;
- ícones sem texto precisam de nome acessível;
- ações destrutivas precisam de confirmação e proteção no banco.

As páginas grandes devem ser decompostas somente quando a mudança em curso
ganhar clareza ou testabilidade. Não refatore uma tela inteira como efeito
colateral de uma correção pequena.

## 10. Invoices e impressão

O sistema usa documentos React preparados para impressão:

- `src/components/billing/InvoiceDocumentLocal.tsx`;
- `src/components/demurrage/InvoiceDocument.tsx`;
- `src/components/shared/InvoiceDocumentKit.tsx`;
- `src/components/shared/invoiceFormat.ts`;
- regras `@media print` em `src/index.css`.

A ação chama `window.print()`. O usuário escolhe impressora ou “Salvar como PDF”
no navegador.

Não adicione biblioteca de PDF sem requisito explícito que o diálogo de
impressão não consiga atender. Use o playbook
`.claude/skills/invoice-pdf.skill`.

## 11. Testes e validação

### Gate local

```powershell
npm run docs:check
npm run lint
npm test
npm run build
```

Execute também o teste focado durante o ciclo red-green.

### Testes de integração

```powershell
$env:SUPABASE_RUN_INTEGRATION = '1'
npm run test:integration
```

Exigem Supabase real e dados controlados. Não aponte a suíte destrutiva para
produção.

### Validação manual

Auth, RLS, RPCs, Edge Functions, email, impressão, PIX e fluxos completos
dependem de ambiente real ou equivalente. Registre ambiente, usuário, dados,
resultado e evidência conforme
[`docs/operations/validacao.md`](./docs/operations/validacao.md).

## 12. CI e deploy

### Pull request

`.github/workflows/ci.yml` executa:

1. instalação reproduzível;
2. verificação documental;
3. lint;
4. build;
5. testes.

### Push em main

`.github/workflows/firebase-deploy.yml` executa build + Firebase Hosting.

### Edge Functions e banco

O deploy Firebase não publica Edge Functions nem aplica migrations. Coordene
essas etapas antes do frontend que depende delas.

## 13. Telemetria e falhas

`src/lib/telemetry.ts` inicializa Sentry somente em produção e associa o release
ao commit injetado no build.

- falhas principais devem chegar à UI e interromper a operação insegura;
- escritas best-effort podem seguir, mas precisam chamar a telemetria;
- não envie segredos ou PII em contexto de erro;
- mensagens ao usuário devem distinguir regra de negócio de indisponibilidade.

## 14. Checklist de mudança

Antes de concluir:

- a mudança é mínima e rastreável ao pedido;
- regras de domínio usam termos do `CONTEXT.md`;
- decisões novas ou supersessões foram registradas;
- rotas, comandos, auth, migrations e procedimentos atualizaram os documentos
  vivos;
- testes focados passaram;
- `npm run docs:check`, lint, testes e build passaram quando aplicáveis;
- `git diff --check` não aponta whitespace;
- snapshots históricos não foram reescritos como se descrevessem o presente.
