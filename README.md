# Transhipping Desk

Plataforma operacional interna da **Transhipping Agenciamento Marítimo Ltda.** — gestão de viagens, manifestos, faturamento, demurrage e portal do cliente. Em **produção**.

**Stack:** React 19 + TypeScript + Vite · Supabase (PostgreSQL + Auth + Edge Functions) · Firebase Hosting · CI/CD via GitHub Actions.

---

## Documentação

A documentação completa vive em **[`docs/`](docs/README.md)**. Atalhos:

- **[Índice](docs/README.md)** — ponto de entrada e mapa de módulos.
- **[Arquitetura](docs/ARCHITECTURE.md)** — stack, camadas, modelo de dados, mapa de rotas.
- **[Glossário](docs/GLOSSARIO.md)** — termos de domínio (B/L, Baplie, CE Mercante, demurrage…).
- **[Módulos](docs/README.md#módulos)** — Faturamento, Viagens, Granito, Manifestos/EDI, Portal, Demurrage, etc.
- **[Setup](docs/setup/development.md)** · **[Deploy](docs/setup/deploy.md)** · **[Testes](docs/setup/testing.md)**
- **[Regras de negócio](docs/operations/regras-de-negocio.md)** · **[Segurança](docs/operations/seguranca.md)**
- **[Roadmap](docs/ROADMAP.md)** · **[ADRs](docs/adr/)** · **[Changelog](docs/CHANGELOG.md)**

---

## Quickstart

```bash
npm ci --legacy-peer-deps          # instala (peer deps exigem a flag)
cp .env.example .env               # preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm run dev                        # http://localhost:5173
```

Aplique as migrations de `supabase/migrations/` no SQL Editor do Supabase e crie um usuário interno. Passo a passo em **[setup/development.md](docs/setup/development.md)**.

```bash
npm run build        # build de produção (tsc + vite)
npm run lint         # ESLint
npm test             # testes unitários (Vitest)
```

---

## Deploy

Automatizado via **GitHub Actions → Firebase Hosting** (projeto `importmanager-bda3e`, target `transhippingdesk`). Todo PR roda CI (lint + build + test) e o fluxo de auto-merge publica o build. Detalhes em **[setup/deploy.md](docs/setup/deploy.md)**.

---

## Diretrizes de desenvolvimento

Comportamento de desenvolvimento assistido por IA: **[CLAUDE.md](CLAUDE.md)**. Convenções específicas (parsers, migrations, invoices, React Query) estão nas skills em `.claude/skills/`.
