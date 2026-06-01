# Validacao do Sistema

Roteiro de validacao do estado atual em 2026-06-01.

## 1. Validacao tecnica local

```powershell
npm install
npm test
npm run lint
npm run build
```

Resultado esperado:

- testes, lint e build sem erro
- build finalizado com geracao normal de bundles

## 2. Validacao de rotas principais

1. Login interno: `/login` -> `/painel`
2. Viagens: `/viagens`
3. Baplie EDI: `/baplie`
4. Manifestos CNTR: `/manifestos`
5. Carga Solta: `/carga-solta`
6. Modulo Granito: `/granito`
7. Taxas de Granito: `/granito/taxas`
8. Vazios Importacao: `/vazios-importacao`
9. Vazios Exportacao: `/embarquevazios`
10. Redirecionamentos:
    - `/vazios` -> `/embarquevazios`
    - `/demurrage/invoices` -> `/demurrage`
    - `/demurrage/reconciliacao` -> `/reconciliacao`

## 3. Fluxos minimos - importacao e operacao

1. Importar manifesto CNTR em `/manifestos` e abrir detalhe de B/L.
2. Importar manifesto BB em `/carga-solta`.
3. Importar Baplie EDI em `/baplie` e validar criacao de vazios de importacao.
4. Importar planilha de veiculos em `/veiculos`.
5. Resolver pendencias em `/revisao`.
6. Validar que B/Ls aprovados avancam para Taxas Locais/Faturamento conforme status.

## 4. Fluxos minimos - Granito

1. Acessar `/granito`.
2. Importar planilha COSCO valida.
3. Confirmar preview com B/Ls e status de vinculacao de cliente.
4. Resolver pendencias de CNPJ quando houver.
5. Confirmar importacao.
6. Calcular cobrancas, marcar pronto e emitir invoice integrada ao faturamento.

## 5. Fluxos minimos - Vazios

1. Acessar `/vazios-importacao`.
2. Importar planilha de containers vazios de chegada ou gerar via Baplie.
3. Validar listagem, filtros e vinculo com viagem.
4. Acessar `/embarquevazios`.
5. Baixar template, importar planilha de bookings de saida e confirmar listagem.

## 6. Validacao de faturamento e portal

1. Em `/faturamento`, validar abas Faturas, Validacao, Pendencias e Demurrage.
2. Emitir invoice local individual pelo fluxo operacional.
3. Emitir invoice consolidada para B/Ls elegiveis do mesmo cliente.
4. Registrar pagamento de invoice local via ledger.
5. Validar Conciliacao PIX em `/reconciliacao`.
6. Validar portal:
   - `/portal/login`
   - `/portal/billing`

## 7. Fluxos complementares em producao

- Alertas (`/alertas`): listar, reconhecer e fechar.
- Relatorios (`/relatorios`): abrir abas e exportar.
- Line Up TV (`/line-up-tv/display`): carregar painel.
- Admin Usuarios (`/admin/usuarios`, perfil admin): alterar role/status.

## 8. Observacao sobre escopo

Este roteiro cobre funcionalidades ativas no produto. Planos de implementacao e specs historicas que ja viraram codigo nao devem permanecer em `docs/`.
