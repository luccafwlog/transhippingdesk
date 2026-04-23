# Transhipping Desk

Plataforma operacional interna para agencia maritima. Cobre o ciclo completo de importacao, revisao de manifestos, gestao de clientes, taxas locais, faturamento, portal do cliente, alertas e relatorios. Frontend em React + TypeScript + Vite, backend em Supabase e deploy em Firebase Hosting.

---

## Modulos em Producao

### Operacao

- **Painel** - KPIs operacionais e financeiros unificados com o Line Up; cards clicaveis para as filas de pendencias; layout reordenado com cards maiores.
- **Viagens** - Cadastro e edicao com multiplos POL/POD, ETD, ETA e ATA. Cards com abas internas (manifesto, agenda POD, importacao/exportacao). Detalhe reestruturado como hub de navegacao. Manifestos agrupados por rota. Importacao e exportacao separadas em acoes independentes. Badge "Faturamento Encerrado" exibido quando todos os B/Ls da viagem estao pagos ou isentos.
- **Manifestos CNTR** - Importacao de `.xlsx` e `.csv`, preview, detalhe do B/L, edicao manual e auditoria.
- **Containers** - Tela consolidada de containers por viagem.
- **Manifestos BB** - Importacao e consulta de carga solta.
- **Veiculos** - Importacao de planilha com vinculo viagem -> container -> B/L.
- **Revisao Manual** - Fila unificada de revisao com busca, filtros, navegacao no modal e avanco automatico. Inclui B/Ls de granito sem cliente vinculado (exibidos com badge `granite`); itens granite abrem modal simplificado apenas para vinculo de cliente.
- **Manifestos Granito** - Importacao do "Relatorio de Cargas/Booking" da COSCO (`.xls`), preview com resolucao de CNPJ ausente, lista de BLs, calculo de faturamento por peso real (`real_weight_kg`). Modal de cobranca tem botao "Aprovar e Faturar" que emite a invoice automaticamente apos aprovacao (bloqueado enquanto o cliente nao estiver vinculado via Revisao).
- **Vazios — Importacao** - Importacao de planilha de movimentacao de containeres vazios que descarregam/chegam; identificados por booking number, vinculados a viagem.
- **Vazios — Exportacao** - Importacao de planilha de movimentacao de containeres vazios que carregam/partem; identificados por booking number, vinculados a viagem.

### Comercial e Financeiro

- **Clientes** - Cadastro mestre, ficha com edicao, regras comerciais, historico de B/Ls e invoices.
- **Taxas Locais** - Tabelas de taxa, overrides por cliente com vigencia, simulacao, acoes em lote, billing runs e fila de reconciliacao de cliente.
- **Faturamento** - Emissao unitaria e consolidada, baixa, cancelamento, detalhe e geracao de PDF.
- **Demurrage** - Pagina unica com abas (Containers | Rascunhos | Emitidas | Pagas). Rota `/demurrage/invoices` redireciona para a pagina unificada. Link direto para Conciliacao PIX no nav.
- **Portal do Cliente** - Login por CNPJ + senha, listagem de B/Ls pendentes, invoices emitidas, detalhe com itens e pagamentos, download de PDF e consolidacao sob demanda.
- **Relatorios** - Tres abas (Operacional, Financeiro, Por Cliente) com filtros, KPIs e export xlsx.

### Operacao e Gestao

- **Alertas** - Alertas operacionais com reconhecimento, fechamento e badge no nav.
- **Line up TV** - Visao consolidada de viagens com auto-refresh para exibicao em painel (unificado com o Painel principal).
- **Admin - Usuarios** - Listagem e gestao de perfis (funcao e status) para administradores.

---

## Fluxo de Trabalho Tipico

```text
1. Cadastrar viagem (navio, rota, datas)
2. Importar manifesto CNTR ou BB -> sistema persiste o lote e dispara billing automatico
3. (Granito) Importar planilha COSCO em /granito -> resolver CNPJs ausentes no preview -> confirmar importacao
4. (Vazios) Importar planilha de bookings em /vazios-importacao ou /vazios-exportacao -> registrar movimentacao operacional da viagem
5. Revisar B/Ls pendentes na fila de Revisao (inclui granito sem cliente); vincular cliente nos itens granite antes de faturar
6. Conferir e ajustar Taxas Locais por B/L; marcar pronto para faturar
7. (Granito) Calcular faturamento por peso real; usar "Aprovar e Faturar" no modal de cobranca para emitir invoice diretamente
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
- `/demurrage` - gestao unificada de D&D com abas (Containers | Rascunhos | Emitidas | Pagas)
- `/reconciliacao` - conciliacao PIX unificada para taxas locais e demurrage
- `/granito` - lista de manifestos e BLs de granito; importacao da planilha COSCO
- `/granito/taxas` - CRUD da tabela de taxas de granito
- `/vazios-importacao` - lista e importacao de containeres vazios que chegam
- `/vazios-exportacao` - lista e importacao de containeres vazios que partem

---

## Estrutura do Projeto

```text
src/
  components/
    layout/       AppLayout, ProtectedRoute, PortalProtectedRoute
    shared/       VoyageImportActions (importacao e exportacao separadas)
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

## Atualizacoes — 2026-04-20

- **Painel**: layout unificado com Line Up, cards KPI maiores, secao de pendencias reordenada.
- **Viagens**: cards ganham abas internas (manifesto, agenda POD, acoes); detalhe refatorado como hub de navegacao; manifestos agrupados por rota; importacao e exportacao separadas em componente proprio; badge "Faturamento Encerrado" aparece quando 100% dos B/Ls estao pagos/isentos; opcoes de status da agenda POD atualizadas.
- **BlDetalhe**: tela reestruturada em 5 abas (Operacional | Carga | Cobranças | Financeiro | Historico) com suporte a deep-link via parametro `?tab=`.
- **Demurrage**: `/demurrage` e `/demurrage/invoices` unificados em pagina unica com abas; rota antiga redireciona automaticamente; nav simplificado com link direto para Conciliacao PIX.
- **Revisao**: fila estendida para incluir BLs de granito sem cliente vinculado; badge de origem (`bl` ou `granite`) distingue os tipos; itens granite abrem modal simplificado de vinculo de cliente.
- **Granito**: botao "Aprovar e Faturar" no modal de cobranca emite invoice automaticamente; bloqueado enquanto nao houver cliente vinculado.
- **Vazios**: itens de nav e PageHeaders renomeados para "Vazios — Importacao" e "Vazios — Exportacao".
- **PIX**: pagina `DemurrageReconciliacao` removida; `/demurrage/reconciliacao` redireciona para `/reconciliacao`, que ja suporta matching unificado de taxas locais e demurrage.

---

## Documentacao Interna

| Arquivo | Conteudo |
|---------|----------|
| `docs/ROADMAP.md` | Estado do produto, funcionalidades entregues e proximos passos |
| `docs/PLANEJAMENTO_GRANITO_VAZIOS.md` | Planejamento tecnico detalhado dos modulos Granito e Vazios |
| `docs/VALIDACAO.md` | Roteiro de validacao operacional por modulo |
| `docs/RESET_AMBIENTE.md` | Procedimento de reset do ambiente de testes |
| `docs/templates/base-clientes-modelo.xlsx` | Modelo de planilha para importacao de clientes |
