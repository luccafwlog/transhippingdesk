# Transhipping Desk

Plataforma operacional interna para agencia maritima. Cobre o ciclo completo de importacao, revisao de manifestos, gestao de clientes, taxas locais, faturamento, alertas e relatorios. Frontend em React + TypeScript + Vite, backend em Supabase, deploy em Firebase Hosting.

---

## Modulos em Producao

### Operacao

- **Painel** — KPIs operacionais e financeiros com cards clicanveis para as filas de pendencias.
- **Viagens** — Cadastro e edicao com multiplos POL/POD, ETD, ETA e ATA.
- **Manifestos CNTR** — Importacao de `.xlsx` e `.csv`, preview, detalhe do B/L, edicao manual e auditoria.
- **Containers** — Tela consolidada de containers por viagem.
- **Manifestos BB** — Importacao e consulta de carga solta.
- **Veiculos** — Importacao de planilha com vinculo viagem → container → B/L.
- **Revisao Manual** — Fila de revisao com busca, filtros, navegacao no modal e avanco automatico.

### Comercial e Financeiro

- **Clientes** — Cadastro mestre, ficha com edicao, regras comerciais, historico de B/Ls e invoices.
- **Taxas Locais** — Tabelas de taxa, overrides por cliente com vigencia, simulacao, acoes em lote.
- **Faturamento** — Emissao unitaria e consolidada, baixa, cancelamento, detalhe e geracao de PDF.
- **Relatorios** — Tres abas (Operacional, Financeiro, Por Cliente) com filtros, KPIs e export xlsx.

### Operacao e Gestao

- **Alertas** — Alertas operacionais com reconhecimento, fechamento e badge no nav.
- **Line up TV** — Visao consolidada de viagens com auto-refresh para exibicao em painel.
- **Admin — Usuarios** — Listagem e gestao de perfis (funcao e status) para administradores.

---

## Fluxo de Trabalho Tipico

```
1. Cadastrar viagem (navio, rota, datas)
2. Importar manifesto CNTR ou BB → sistema calcula taxas automaticamente
3. Revisar B/Ls pendentes na fila de Revisao
4. Conferir e ajustar Taxas Locais por B/L; marcar pronto para faturar
5. Emitir invoice em Faturamento (unitaria ou consolidada)
6. Registrar baixa apos pagamento
7. Consultar Relatorios e exportar para xlsx
```

---

## Estrutura do Projeto

```
src/
  components/
    layout/       AppLayout, ProtectedRoute
    ui/           Button, Card, EmptyState, InlineError, PageHeader, ...
  hooks/          useAuth, useOperationalCounts, useViagens, useBls, ...
  pages/          uma pagina por rota
  services/       camada de acesso ao Supabase (bls, clientes, taxas, invoices, ...)
  lib/            utils, supabaseClient
  parsers/        parser CNTR, parser BB, parser de veiculos

supabase/
  migrations/     001 a 024 — migrations SQL versionadas

docs/
  ROADMAP.md      Estado do produto e proximos passos
  VALIDACAO.md    Roteiro de validacao operacional
  RESET_AMBIENTE.md  Procedimento de reset do ambiente de testes
```

---

## Configuracao Local

1. Copie `.env.example` para `.env`.
2. Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
3. Execute as migrations SQL no Supabase (`supabase/migrations/` em ordem).
4. Crie usuarios no Supabase Auth.
5. Insira o perfil correspondente em `user_profiles` com `role = 'admin'` ou `'operator'`.

---

## Scripts

```bash
npm run dev              # servidor de desenvolvimento
npm run build            # build de producao
npm run lint             # lint com ESLint
npm test                 # testes unitarios com vitest
npm run test:integration # testes de integracao com Supabase real (requer .env preenchido)
```

---

## Deploy

Projeto Firebase Hosting: `importmanager-bda3e`

```bash
npm run build
npx firebase-tools deploy --only hosting
```

---

## Documentacao Interna

| Arquivo | Conteudo |
|---------|----------|
| `docs/ROADMAP.md` | Estado do produto, funcionalidades entregues e proximos passos |
| `docs/VALIDACAO.md` | Roteiro de validacao operacional por modulo |
| `docs/RESET_AMBIENTE.md` | Procedimento de reset do ambiente de testes |
| `docs/templates/base-clientes-modelo.xlsx` | Modelo de planilha para importacao de clientes |
