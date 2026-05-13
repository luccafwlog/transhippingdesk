# Validacao do Sistema

Roteiro de validacao do estado atual em 2026-05-13.

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
2. Modulo Granito: `/granito`
3. Taxas de Granito: `/granito/taxas`
4. Vazios Importacao: `/vazios-importacao`
5. Vazios Exportacao: `/embarquevazios`
6. Redirecionamentos:
   - `/vazios` -> `/embarquevazios`
   - `/demurrage/invoices` -> `/demurrage`
   - `/demurrage/reconciliacao` -> `/reconciliacao`

## 3. Fluxos minimos - Granito

1. Acessar `/granito`.
2. Importar planilha COSCO valida.
3. Confirmar preview com BLs e status de vinculacao de cliente.
4. Resolver pendencias de CNPJ quando houver.
5. Confirmar importacao.
6. Verificar listagem atualizada e acoes de calculo/faturamento.

## 4. Fluxos minimos - Vazios Importacao

1. Acessar `/vazios-importacao`.
2. Importar planilha de containers vazios de chegada.
3. Confirmar preview.
4. Confirmar importacao.
5. Validar listagem e filtros.

## 5. Fluxos minimos - Vazios Exportacao

1. Acessar `/embarquevazios`.
2. Baixar template e conferir formato.
3. Importar planilha de bookings de saida.
4. Confirmar preview.
5. Confirmar importacao.
6. Validar listagem e filtros.

## 6. Fluxos complementares em producao

- Alertas (`/alertas`): listar, reconhecer e fechar.
- Relatorios (`/relatorios`): abrir abas e exportar.
- Line Up TV (`/line-up-tv/display`): carregar painel.
- Admin Usuarios (`/admin/usuarios`, perfil admin): alterar role/status.

## 7. Validacao de faturamento e portal

1. Emitir invoice em `/faturamento`.
2. Registrar pagamento parcial e total.
3. Validar acesso ao portal:
   - `/portal/login`
   - `/portal/billing`

## 8. Observacao sobre escopo

Este roteiro cobre apenas funcionalidades ativas no produto. Documentos historicos e baseline legado ficam em `docs/archive/`.
