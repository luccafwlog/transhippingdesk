# Chegadas e Saídas

> **Status:** ativo · **Atualizado:** 2026-07-09 · **Rota interna:** `/chegadas-saidas` · **Consumidor:** widget do Dashboard do Portal

## Propósito e escopo

Este módulo publica a programação comercial de navios no Portal do Cliente a
partir da própria **Viagem**. Conforme ADR 0021, cadastrar em
`/chegadas-saidas` cria ou anexa uma viagem operacional e grava POL/ETD e
POD/ETA em `audit_logs` pelos mesmos serviços de rota usados por `/viagens`.

`vessel_schedules` e `ended_vessels` permanecem no histórico de schema, mas a
tela atual não escreve mais nelas. Não houve migração de dados legados.

Fontes principais: `src/pages/ChegadasSaidas.tsx`,
`src/pages/chegadasSaidasForm.ts`, `src/services/voyageFromSchedule.ts`,
`src/services/portalScheduleVoyages.ts`, `src/services/portalScheduleLanes.ts`,
`src/services/portalScheduleBulkImport.ts`,
`src/components/portal/ShipScheduleWidget.tsx` e migrations `172`/`173`.

## Anatomia das telas

### Rota interna `/chegadas-saidas`

A página lista viagens com `show_on_portal = true` por
`fetchPortalScheduleVoyages()`, projetando cada viagem na grade fixa de lanes
`PORTAL_SCHEDULE_LANES`: Qingdao, Shanghai, Taicang, Ningbo, Nansha, Salvador,
Vitória e Pecém.

O modal pede navio, VOY, IMO e uma data ISO por lane. Checkbox "não escala"
deixa a lane sem data e, portanto, sem schedule. Ao salvar,
`createOrAttachVoyageFromSchedule` deduplica por VOY + IMO (fallback nome),
cria ou anexa a viagem, liga `show_on_portal` e grava somente ETD de POL e ETA
de POD. ATA, ATD, RTW, CE status, escala e vínculo não são sobrescritos.

Na **edição**, apenas as datas da programação são editáveis — navio, VOY e IMO
são read-only (corrigidos na tela Viagens). Marcar um porto como "não escala"
cancela aquela escala: o ETD/ETA publicado é removido e, se a escala não tiver
âncora operacional (manifesto vinculado, ATA/ATD ou B/L), ela é removida também
de Viagens e do Line-Up. O upload em lote nunca cancela escalas — células vazias
ou "X" são ignoradas.

Remover uma linha do quadro chama `setVoyageShowOnPortal(id, false)`; a viagem
operacional continua existindo e só pode ser excluída em `/viagens`.

O upload em lote baixa um template gerado da mesma constante de lanes. Cada
linha da planilha (`VESSEL NAME`, `VOY`, `IMO`, lanes ETD/ETA) vira uma chamada
ao mesmo `createOrAttachVoyageFromSchedule`. Datas aceitas: ISO ou
`DD/MM/AAAA`; vazio/`X` significa "não escala".

### Widget do Portal

`ShipScheduleWidget` usa `usePortalScheduleVoyages` com query key
`['portal-schedule-voyages']`. O serviço chama a RPC `portal_ship_schedule`,
que é `SECURITY DEFINER` e allowlisted para `anon`, retornando somente viagens
ativas com `show_on_portal = true`. O widget renderiza as colunas pela constante
de lanes e ordena pela menor ETA de POD.

## Catálogo de ações

| Tela / ação | Pré-condições | Origem | Orquestração | Persistência | Efeitos e cache | Evidência |
|---|---|---|---|---|---|---|
| Carregar publicados | Sessão interna | Montagem de `/chegadas-saidas` | `useQuery(['portal-schedule-voyages'])` | RPC `portal_ship_schedule` projetada em linhas | Preenche tabela por ETA | **Código**, **Teste** |
| Adicionar/anexar viagem | Papel diferente de Equipamentos; navio, VOY e ao menos um POD com data | Modal | `buildScheduleLanes` + `createOrAttachVoyageFromSchedule` | `voyages.show_on_portal`, `audit_logs` POL/POD | Invalida `['portal-schedule-voyages']` e `['voyages']` | **Código**, **Teste** |
| Editar publicação | Papel diferente de Equipamentos; viagem já visível | Botão Editar/modal | Pré-preenche datas projetadas e salva pelo mesmo serviço | Atualiza somente ETD/ETA informados | Last write wins em ETD/ETA digitados | **Código**, **Teste** |
| Remover do Portal | Papel diferente de Equipamentos; confirmação | Botão Remover do Portal | `setVoyageShowOnPortal(id, false)` | Atualiza `voyages.show_on_portal` | Remove do quadro sem excluir viagem | **Código**, **Teste** |
| Importar planilha | Papel diferente de Equipamentos; arquivo `.xlsx/.xls/.csv` | `SpreadsheetUpload` | `parseScheduleRows` + `createOrAttachVoyageFromSchedule` por linha | Mesma persistência do modal | Resumo de sucesso/erro por linha; invalida caches | **Código**, **Teste** |
| Consultar no Portal | Sessão do Portal | `ShipScheduleWidget` | `usePortalScheduleVoyages` | RPC `portal_ship_schedule` | Cache `['portal-schedule-voyages']` | **Código**, **Teste**, **Teste de contrato SQL** |

## Fluxos e invariantes

- A lista de portos-vitrine é única em `PORTAL_SCHEDULE_LANES`.
- `show_on_portal` controla visibilidade; viagens manuais começam ocultas.
- Viagens `completed` não aparecem na RPC do Portal.
- PODs omitidos pelo armador (`audit_logs.field_name='omitted'`) nao aparecem
  na projecao do Portal, ainda que permanecam rastreaveis em Viagens.
- "Não escala" não cria schedule para a lane.
- Chegadas e Saídas nunca grava ATA/ATD/RTW/CE/linked.
- A ordenação do quadro é automática pela menor ETA; não há setas manuais nem
  arquivamento em `ended_vessels` no fluxo atual.

## Estado e dados

| Dado | Fonte atual |
|---|---|
| Visibilidade no Portal | `voyages.show_on_portal` |
| POL/ETD | `audit_logs` com `entity_type='voyage_pol_schedule'` |
| POD/ETA | `audit_logs` com `entity_type='voyage_pod_schedule'` |
| Portos-vitrine | `PORTAL_SCHEDULE_LANES` |
| Leitura do Portal | RPC `portal_ship_schedule` |

## Testes e validação

- `src/pages/__tests__/chegadasSaidasForm.test.ts`
- `src/pages/__tests__/ChegadasSaidas.behavior.test.tsx`
- `src/services/__tests__/portalScheduleBulkImport.test.ts`
- `src/services/__tests__/portalScheduleVoyages.test.ts`
- `src/services/__tests__/portalShipScheduleMigration.test.ts`
- `src/components/portal/__tests__/ShipScheduleWidget.test.tsx`

## Notas e divergências

- As tabelas `vessel_schedules` e `ended_vessels` seguem versionadas porque
  ambientes antigos podem tê-las, mas não são usadas pelo fluxo atual.
- A leitura das duas era `USING (true)` para qualquer `authenticated` — o que
  incluía o cliente do Portal, contornando o portão `voyages.show_on_portal`.
  A migration `257` passou a exigir `is_active_read_user()` e removeu o serviço
  e o hook mortos que as liam pela sessão do Portal. Ver
  `docs/archive/audits/security-audit-portal-2026-08-05.md`.
- A RPC `portal_ship_schedule` ainda precisa ser aplicada no ambiente Supabase
  alvo antes do Portal consumir dados reais.
