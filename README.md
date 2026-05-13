# Transhipping Desk

Plataforma operacional interna para agencia maritima.
Frontend em React + TypeScript + Vite, backend em Supabase, deploy em Firebase Hosting.

## Modulos em producao

- Operacao: Painel, Viagens, Manifestos CNTR/BB, Containers, Veiculos, Revisao Manual.
- Granito: `/granito`, `/granito/taxas`.
- Vazios:
  - Importacao: `/vazios-importacao`
  - Exportacao: `/embarquevazios` (`/vazios` redireciona para esta rota)
- Comercial/Financeiro: Clientes, Taxas Locais, Faturamento, Demurrage, Portal do Cliente.
- Gestao: Alertas, Relatorios, Line Up TV, Admin Usuarios.

## Fluxo operacional tipico

```text
1. Cadastrar viagem
2. Importar manifesto CNTR ou BB
3. (Granito) Importar planilha COSCO em /granito
4. (Vazios) Importar em /vazios-importacao e /embarquevazios
5. Revisar pendencias em /revisao
6. Calcular e revisar taxas em /taxas-locais
7. Emitir invoices em /faturamento
8. Registrar pagamentos
9. Consultar relatorios
```

## Rotas principais

- `/painel`
- `/viagens`
- `/manifestos`
- `/carga-solta`
- `/containers`
- `/veiculos`
- `/revisao`
- `/clientes`
- `/taxas-locais`
- `/faturamento`
- `/demurrage`
- `/reconciliacao`
- `/granito`
- `/granito/taxas`
- `/vazios-importacao`
- `/embarquevazios`
- `/portal/login`
- `/portal/billing`

## Configuracao local

1. Copie `.env.example` para `.env`.
2. Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
3. Execute migrations SQL em `supabase/migrations/`.
4. Crie usuarios no Supabase Auth e perfis em `user_profiles`.

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm test
npm run test:integration
```

## Deploy

Projeto Firebase Hosting: `importmanager-bda3e`

```bash
npm run build
npx firebase-tools deploy --only hosting
```

## Documentacao interna

### Ativa

- `docs/ROADMAP.md`
- `docs/VALIDACAO.md`
- `docs/RESET_AMBIENTE.md`

### Historico

- `docs/PLANEJAMENTO_GRANITO_VAZIOS.md`
- `docs/archive/RELEASE_BASELINE_2026-04-14.md`
- `docs/archive/pagebypage_legacy.md`
