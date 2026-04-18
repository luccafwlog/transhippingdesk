# Transhipping Desk

Plataforma operacional interna para agencia maritima. Cobre o ciclo completo de importacao, revisao de manifestos, gestao de clientes, taxas locais, faturamento, portal do cliente, alertas e relatorios. Frontend em React + TypeScript + Vite, backend em Supabase e deploy em Firebase Hosting.

---

## Modulos em Producao

### Operacao

- **Painel** - KPIs operacionais e financeiros com cards clicaveis para as filas de pendencias.
- **Viagens** - Cadastro e edicao com multiplos POL/POD, ETD, ETA e ATA.
- **Manifestos CNTR** - Importacao de `.xlsx` e `.csv`, preview, detalhe do B/L, edicao manual e auditoria.
- **Containers** - Tela consolidada de containers por viagem.
- **Manifestos BB** - Importacao e consulta de carga solta.
- **Veiculos** - Importacao de planilha com vinculo viagem -> container -> B/L.
- **Revisao Manual** - Fila de revisao com busca, filtros, navegacao no modal e avanco automatico.
- **Manifestos Granito** _(planejado)_ - Importacao do "Relatorio de Cargas/Booking" da COSCO (`.xls`), preview com resolucao de CNPJ ausente, lista de BLs, calculo de faturamento por peso real (`real_weight_kg`) com tabela de taxas propria.
- **Manifestos Vazios** _(planejado)_ - Importacao de planilha de movimentacao de containeres vazios identificados por booking number (sem B/L), vinculados a viagem.

### Comercial e Financeiro

- **Clientes** - Cadastro mestre, ficha com edicao, regras comerciais, historico de B/Ls e invoices.
- **Taxas Locais** - Tabelas de taxa, overrides por cliente com vigencia, simulacao, acoes em lote, billing runs e fila de reconciliacao de cliente.
- **Faturamento** - Emissao unitaria e consolidada, baixa, cancelamento, detalhe e geracao de PDF.
- **Portal do Cliente** - Login por CNPJ + senha, listagem de B/Ls pendentes, invoices emitidas, detalhe com itens e pagamentos, download de PDF e consolidacao sob demanda.
- **Relatorios** - Tres abas (Operacional, Financeiro, Por Cliente) com filtros, KPIs e export xlsx.

### Operacao e Gestao

- **Alertas** - Alertas operacionais com reconhecimento, fechamento e badge no nav.
- **Line up TV** - Visao consolidada de viagens com auto-refresh para exibicao em painel.
- **Admin - Usuarios** - Listagem e gestao de perfis (funcao e status) para administradores.

---

## Fluxo de Trabalho Tipico

```text
1. Cadastrar viagem (navio, rota, datas)
2. Importar manifesto CNTR ou BB -> sistema persiste o lote e dispara billing automatico
3. (Granito) Importar planilha COSCO em /granito -> resolver CNPJs ausentes no preview -> confirmar importacao
4. (Vazios) Importar planilha de bookings em /vazios -> registrar movimentacao operacional da viagem
5. Revisar B/Ls pendentes na fila de Revisao e na fila de reconciliacao de cliente, quando houver bloqueio
6. Conferir e ajustar Taxas Locais por B/L; marcar pronto para faturar
7. (Granito) Calcular faturamento por peso real; revisar breakdown de taxas no detalhe do BL
8. Emitir invoice em Faturamento (unitaria ou consolidada)
9. Opcional: cliente acessa /portal/login e consolida B/Ls proprios em /portal/billing
10. Registrar baixa apos pagamento
11. Consultar Relatorios e exportar para xlsx
```

---

## Rotas Relevantes

- `/taxas-locais` - fila operacional de taxas, billing runs e reconciliacao de cliente
- `/faturamento` - emissao interna, cancelamento e baixa
- `/clientes/:cnpj` - ficha do cliente e provisionamento do acesso ao portal
- `/portal/login` - autenticacao externa do cliente
- `/portal/billing` - consultas e consolidacao pelo portal
- `/granito` - lista de manifestos e BLs de granito; importacao da planilha COSCO _(planejado)_
- `/granito/taxas` - CRUD da tabela de taxas de granito _(planejado)_
- `/vazios` - lista de manifestos de containeres vazios; importacao por booking _(planejado)_

---

## Estrutura do Projeto

```text
src/
  components/
    layout/       AppLayout, ProtectedRoute, PortalProtectedRoute
    ui/           Button, Card, EmptyState, InlineError, PageHeader, ...
  hooks/          useAuth, useOperationalCounts, usePortalAuth, usePortalBilling, ...
  pages/          uma pagina por rota, incluindo o portal de faturamento
  services/       camada de acesso ao Supabase (bls, clientes, taxas, invoices, portal, ...)
  lib/            utils, supabaseClient
  parsers/        parser CNTR, parser BB, parser de veiculos

supabase/
  migrations/     001 a 027 - migrations SQL versionadas

docs/
  ROADMAP.md         Estado do produto e proximos passos
  VALIDACAO.md       Roteiro de validacao operacional
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

## Validacao Recente

Em 2026-04-17 foi validado com Supabase real o fluxo externo do portal:

- login por CNPJ + senha
- overview de sessao com saldo aberto derivado de invoices ativas
- listagem de B/Ls elegiveis
- listagem de invoices
- detalhe de invoice com itens e pagamentos
- consolidacao de 2 B/Ls do cliente `10268203000117`, gerando a invoice `INV-2026-0005` no valor de BRL 8.680,00

O acesso temporario criado para o teste foi removido ao final. A invoice gerada foi mantida no banco, conforme autorizado.

---

## Documentacao Interna

| Arquivo | Conteudo |
|---------|----------|
| `docs/ROADMAP.md` | Estado do produto, funcionalidades entregues e proximos passos |
| `docs/PLANEJAMENTO_GRANITO_VAZIOS.md` | Planejamento tecnico detalhado dos modulos Granito e Vazios |
| `docs/VALIDACAO.md` | Roteiro de validacao operacional por modulo |
| `docs/RESET_AMBIENTE.md` | Procedimento de reset do ambiente de testes |
| `docs/templates/base-clientes-modelo.xlsx` | Modelo de planilha para importacao de clientes |
