# Viagens

> **Status:** ativo · **Atualizado:** 2026-07-02 · **Rotas:** `/viagens`, `/viagens/:voyageId`

## Propósito e escopo

Centro operacional da **Viagem**: um navio identificado por número de viagem, acompanhado em suas escalas, agendas, documentos e cargas. O módulo é o agregador master-detail de planejamento POL/POD, exportação, CE Master, indicadores Mercante, timeline e conciliação Baplie × B/L; a persistência dos imports pertence a [Manifestos & EDI](manifesto-edi.md), Granito e Vazios.

As duas rotas usam a mesma página, `src/pages/Viagens.tsx`, registrada em `src/App.tsx`. O rail e a rota dedicada seguem a [ADR 0012](../adr/0012-viagens-master-detail-rota-dedicada.md). Termos como Viagem, Escala, Número de Escala, Vínculo de Manifestos, CE Mercante e CE Master seguem `CONTEXT.md`.

Fontes principais: `src/pages/Viagens.tsx`, `src/services/voyageSummaries.ts`, `src/lib/voyageFormat.ts`, `src/components/voyages/VoyageCard.tsx`, `src/hooks/useViagemSchedulesAndStats.ts`, `src/services/voyages.ts`, `src/services/voyageRouteSchedules.ts`, `src/services/voyageExportSchedules.ts` e `src/services/voyageTimeline.ts`.

## Anatomia das telas

### `/viagens`

- `src/pages/Viagens.tsx` carrega até 500 viagens por `useVoyages` em `src/hooks/useBls.ts`, junto de B/Ls, batches, Granito e vazios de exportação.
- `src/components/shared/VoyageCombobox.tsx` é o seletor preditivo compartilhado para telas que apontam uma viagem fora do rail; filtros usam modo `clearable` e importações usam modo `required`, ambos sobre o cache local de `useVoyageOptions`.
- `src/components/voyages/VoyageFilters.tsx` oferece busca por navio, viagem, armador e porto; período (`hoje`, `7d`, `30d` ou intervalo); status; e conciliação.
- `src/lib/viagensFilters.ts` filtra localmente e ordena por próxima escala com ETA ascendente, depois por navio/viagem. Viagens sem próxima escala ficam ao final.
- `src/components/voyages/VoyageRail.tsx` mostra rota POL→POD, B/Ls, containers distintos, próxima escala e estado de conciliação. A seleção navega para `/viagens/:voyageId`.
- O rail pode ser recolhido; essa preferência é local em `localStorage['viagens:rail-collapsed']`.
- Sem seleção, o desktop mostra o estado “Selecione uma viagem”; no mobile o rail ocupa a lista principal.
- Usuários admin veem “Nova Viagem” e edição no item do rail. O cadastro também aceita PODs/ETAs antecipados para o Line-Up.

### `/viagens/:voyageId`

- `useParams()` converte `:voyageId` com `Number`. Se não houver viagem correspondente, a página mantém a URL e mostra “Viagem não encontrada”; não há redirect automático.
- `src/components/voyages/VoyageCard.tsx` possui quatro abas locais, não sincronizadas na URL: `visao`, `importacao`, `exportacao` e `manifestos`.
- **Visão geral:** KPIs, planejamento por POD/POL, edição/exclusão de agenda, cards contextuais e timeline. O planejamento aprovado registra, por escala, ETA/ATA, ETB/ATB e ETD/ATD, mantendo previsão e realização em campos distintos; o código atual ainda não cobre o conjunto completo.
- **Importação:** métricas por POD para containers, IMO/OOG, veículos, B/L, carga geral, carga solta e vazios de importação; inclui importação rápida por `src/components/shared/VoyageImportActions.tsx`. A ordem aprovada das ações é Baplie EDI, B/L, CE Mercante, Manifesto BB, Veículos e Vazios IMP; Manifesto CNTR deixa de integrar a aba. Os modais de CE Mercante, Manifesto BB e Veículos oferecem suas planilhas-modelo.
- **Exportação:** métricas por POL para Granito e vazios de exportação; inclui importação rápida de Granito e bookings de vazios.
- **Escalas & Manifestos:** resumo de conciliação, cobertura de CE Mercante, rotas derivadas dos B/Ls por POL/POD, ETD/ATD por POL e CE Master por rota. O nome da aba e metadados de batch são legado pendente de alinhamento à ADR 0025.
- A timeline é expansível e combina imports, agendas, dados da viagem, CE Master, Baplie e resoluções de divergência.
- Navegação contextual:
  - `/manifestos?voyage=<id>`;
  - `/carga-solta?voyage=<id>`;
  - `/granito?voyage=<id>`;
  - `/vazios?voyage=<id>` (rota de compatibilidade que redireciona para `/embarquevazios`);
  - `/baplie?voyage=<id>`.

## Catálogo de ações

| Tela / ação | Pré-condições | Origem | Orquestração | Persistência | Efeitos e cache | Falhas | Evidência |
|---|---|---|---|---|---|---|---|
| `/viagens` — buscar, filtrar e ordenar rail | Lista carregada; filtros são locais | `VoyageFilters` | `filterVoyageRailItems` combina busca, status, conciliação e período; ordena por ETA/navio | Nenhuma | Não altera cache; contador deriva da lista visível | ETA ausente exclui a viagem dos filtros de período; intervalo vazio não filtra | `src/components/voyages/VoyageFilters.tsx`; `src/lib/viagensFilters.ts`; `src/lib/__tests__/viagensFilters.test.ts` |
| `/viagens` — selecionar viagem e sincronizar rota | ID existente no rail | `VoyageRail.onSelect` | `navigate('/viagens/' + id)`; voltar no mobile usa `/viagens` | Nenhuma | A troca monta `VoyageCard` com `key={voyage.id}` e reinicia estado local das abas | ID removido entre lista e clique cai no estado “não encontrada” | `src/pages/Viagens.tsx`; `src/components/voyages/VoyageRail.tsx` |
| `/viagens/:voyageId` — tratar ID inválido ou excluído | Parâmetro presente | `selectedVoyageId = Number(voyageId)` | Busca em `voyages.find`; não consulta detalhe isolado | Nenhuma | Mantém lista e URL atuais | `NaN`, ID inexistente ou removido mostra estado vazio; não redireciona | `src/pages/Viagens.tsx`; `docs/adr/0012-viagens-master-detail-rota-dedicada.md` |
| Criar ou editar viagem | Admin para abrir pela página; usuário autenticado para auditoria completa | `VoyageCreateModal` | Zod normaliza armador, SCAC, navio, IMO, viagem, status, POL/ETD e POD/ETA; `createVoyage`/`updateVoyage` reutilizam ou criam carrier/vessel | `carriers`, `vessels`, `voyages`; eventos `entity_type='voyages'`; POL/ETD e POD/ETA via `audit_logs` | Invalida `['voyages']`, `['voyage-options']`, `['voyage-pod-schedules']`, `['bls']`, `['lineup-tv-v3']`, `['lineup-tv-display-v2']` | Validação do formulário; falha de lookup/insert/update/auditoria | `src/components/shared/VoyageCreateModal.tsx`; `src/services/voyageForm.ts`; `src/services/voyages.ts` |
| Excluir viagem | Admin; sem B/L, batch CNTR/BB, manifesto de Granito ou manifesto de vazios | Modal em `Viagens` | `deleteVoyage` pré-conta dependências e só então executa delete | `voyages` | Invalida `['voyages']`, `['voyage-options']`, `['voyage-pod-schedules']`, `['bls']`, `['containers']`, `['dashboard']`, `['lineup-tv-v3']`, `['lineup-tv-display-v2']`; seleção volta a `/viagens` | Dependências bloqueiam com contagens; RLS/DB podem negar | `src/pages/Viagens.tsx`; `src/services/voyages.ts` |
| Adicionar ou editar schedule POD | Usuário com `user.id`; POD não vazio para inclusão | `AddPodToVoyageModal` / `PodScheduleModal` | `saveVoyagePodSchedule` compara o estado reconstruído e insere apenas campos alterados; ATD pode alternar status da viagem | `audit_logs`, `entity_type='voyage_pod_schedule'`, `entity_id='<voyageId>::<POD>'`; trigger materializa `voyages.pod_schedule_snapshot` | Invalida `['voyage-pod-schedules']`, `['voyage-timeline']`, `['lineup-tv-v3']`, `['lineup-tv-display-v2']` | Sessão sem usuário; insert de auditoria; atualização de status da viagem | `src/pages/Viagens.tsx`; `src/components/shared/VoyageScheduleModals.tsx`; `src/services/voyageRouteSchedules.ts`; `supabase/migrations/046_voyage_schedule_snapshot_trigger.sql` |
| Editar schedule POL e CE Master | Usuário com `user.id`; rota POL/POD derivada dos B/Ls; CE Master editável em qualquer rota | `PolScheduleModal` | Salva ETD e ATD em `saveVoyagePolSchedule`; com batches, grava o mesmo CE Master em todos os batches do manifesto (`setImportBatchCeMaster`); sem batch (viagem só-B/L), grava CE Master por rota via `setVoyageRouteCeMaster` (RPC `set_voyage_route_ce_master`) | ETD/ATD em `audit_logs` (`voyage_pol_schedule`); CE Master em `import_batches.ce_master` **ou** `voyage_route_ce_master`, ambos com evento em `audit_logs` | Invalida `['voyage-pol-schedules']`, `['voyage-pod-schedules']`, `['voyage-route-ce-masters']`, `['voyage-timeline']`, `['voyages']` | Falha parcial é possível entre datas da agenda POL e updates de CE Master, pois a sequência do frontend não é transação única; CE Master não entra no EDI (só registro) | `src/pages/Viagens.tsx`; `src/services/voyageRouteSchedules.ts`; `src/services/manifestImport.ts`; `supabase/migrations/125_import_batches_ce_master.sql`; `supabase/migrations/167_voyage_route_ce_master.sql` |
| Excluir snapshot/POD do planejamento | Admin; POD sem B/L vinculado; possui dados de agenda ou `linked=true`; usuário autenticado | Lixeira da grade em `VoyageCard` | `deleteVoyagePodSchedule` grava `deleted=true`; a leitura omite schedules cujo último marcador está deletado | Evento insert-only em `audit_logs`; trigger atualiza `pod_schedule_snapshot` | Invalida `['voyage-pod-schedules']`, `['voyage-timeline']`, `['lineup-tv-v3']`, `['lineup-tv-display-v2']` | B/L vinculado bloqueia; ausência de dados vira informação; `42501` é traduzido como falta de permissão | `src/components/voyages/VoyageCard.tsx`; `src/services/voyageRouteSchedules.ts`; `supabase/migrations/052_fix_voyage_snapshot_null_new_value.sql` |
| Omitir escala | Admin; escala ativa; Porto de Transbordo diferente do POD omitido; existe outro POD ativo para descarga; usuário autenticado | Botao de alerta na grade em `VoyageVisaoTab` + `OmitEscalaModal` | Estado atual cria omissao e linhas por B/L; desenho aprovado deve mover porto, navio, armador, viagem, ETD, ETA e motivo para um registro global da omissao, preenchível progressivamente, mantendo COD por B/L | `voyage_omissions`, `bl_transshipments`, `audit_logs.field_name='omitted'`, `portal_notifications.type='transshipment'` | Invalida transbordos, POD schedules, timeline, viagens, B/Ls e Line-Up; notifica a omissao para os B/Ls afetados, mesmo que um B/L receba depois uma segunda notificacao ao virar COD | UI oculta a acao sem POD alternativo; RPC valida usuario ativo, `changed_by=auth.uid()`, PODs nao vazios/diferentes e viagem existente | `src/components/voyages/OmitEscalaModal.tsx`; `src/hooks/useTransshipments.ts`; `src/services/transshipments.ts`; migrations `174`/`175`; testes `voyageOmissionsMigration`, `voyageSummaries.omitted`, `voyageRouteSchedules.omitted` |
| Definir transbordo (navio de terceiros) | Omissao registrada e B/L afetado | `TransshipmentPanel` | `useSetBlDisposition().setTransshipment` chama `set_bl_transshipment`; se estava em COD, restaura o POD original | `bl_transshipments` e `audit_logs` do B/L | Invalida transbordos, B/Ls e viagens | RPC valida usuario ativo e linha existente | `src/components/voyages/TransshipmentPanel.tsx`; `src/services/transshipments.ts`; migration `174` |
| Marcar COD | Omissao registrada e B/L afetado | `TransshipmentPanel` | `useSetBlDisposition().setCod` chama `set_bl_cod`; limpa campos de navio terceiro e altera `bls.pod` para o porto de descarga | `bl_transshipments`, `bls.pod`, `audit_logs`, `portal_notifications.type='transshipment'` | Invalida transbordos, B/Ls e viagens | RPC valida usuario ativo e linha existente | `src/components/voyages/TransshipmentPanel.tsx`; `src/services/transshipments.ts`; migration `174` |
| Criar/editar ou excluir export schedule | Admin | `ExportScheduleModal` e linha EXP | Upsert por `voyage_id`; delete por `id` | `voyage_export_schedules` | Invalida `['voyage-export-schedules']`, `['lineup-tv-v3']`, `['lineup-tv-display-v2']` | Erro de RLS/DB; a UI mostra mensagem genérica | `src/pages/Viagens.tsx`; `src/components/voyages/VoyageCard.tsx`; `src/services/voyageExportSchedules.ts` |
| Carregar timeline | Viagem selecionada | `useVoyageTimeline` | Busca agendas e auditoria, resoluções Baplie, primeira importação Baplie e nomes de atores; `buildVoyageTimeline` humaniza e ordena | Leitura de `audit_logs`, `baplie_reconciliation_resolutions`, `baplie_containers`, `user_profiles`; batches vêm do payload de voyages | Família `['voyage-timeline', voyageId]`, stale time 60 s | Qualquer fonte obrigatória com erro rejeita a query; não há paginação além dos ranges de 500 eventos por fonte | `src/hooks/useVoyageTimeline.ts`; `src/services/voyageTimeline.ts`; `src/services/voyageSummaries.ts` |
| Carregar resumo de conciliação | Viagem selecionada; staging/manifesto podem estar vazios | `useVoyageReconciliation` | `reconcileBaplieWithManifest` compara Baplie `full` com `bl_containers` da viagem | Leitura de `baplie_containers`, `bls`, `bl_containers`, `baplie_reconciliation_resolutions` | Família `['baplie-reconciliation', voyageId]`, compartilhada com `/baplie`, stale time 60 s | Consultas paginadas podem falhar; part lot com múltiplos matches não gera decisão automática | `src/hooks/useVoyageReconciliation.ts`; `src/services/baplieReconciliation.ts` |
| Navegar para manifestos, carga solta, Granito, vazios e Baplie | Card habilitado quando há dados; Baplie aparece para divergências | `NavigationCard` / botão “Resolver divergências” | `navigate` acrescenta `?voyage=<id>` | Nenhuma | A tela destino decide se consome o parâmetro | `/carga-solta` não lê hoje o parâmetro; `/vazios` redireciona sem preservar explicitamente a query | `src/components/voyages/VoyageCard.tsx`; `src/App.tsx`; `src/pages/Manifestos.tsx`; `src/pages/CargaSolta.tsx`; `src/pages/EmbarqueVazios.tsx` |
| Importação rápida no contexto da viagem | Usuário autenticado; tipo disponível na aba | `VoyageImportActions` | Abre parsers/previews com `voyageId` travado. A interface aprovada expõe, nesta ordem: Baplie EDI, B/L, CE Mercante, Manifesto BB, Veículos e Vazios IMP; o código ainda diverge ao exibir Manifesto CNTR e não oferecer CE Mercante | Conforme o importador proprietário | Usa arrays literais como `['bls']`, `['voyages']`, `['lineup-tv-v3']`, `['baplie-staging', voyageId]`, `['vehicles']` | CE Mercante deve rejeitar no preview linhas de B/L pertencentes a outra viagem; CE Mercante, BB e Veículos oferecem planilhas-modelo; a atomicidade varia por importador | `src/components/shared/VoyageImportActions.tsx`; `src/components/shared/FileImportModal.tsx`; `src/components/shared/CeMercanteImportModal.tsx` |

## Estado e dados

Famílias canônicas de cache:

| Família | Forma no código | Fonte |
|---|---|---|
| Viagens agregadas | `queryKeys.voyages.all()` | `voyages` + relações carregadas por `useVoyages` |
| Indicador de billing | `queryKeys.voyages.billingStatus(voyageIds)` | `fetchVoyagesWithUnpaidBls` em `src/services/voyages.ts` |
| POL | `queryKeys.voyages.polSchedules(entityIds)` | estado reconstruído de `audit_logs` |
| POD | `queryKeys.voyages.podSchedules(voyageIds)` | estado reconstruído de `audit_logs` |
| Transbordos | `queryKeys.transshipments.byVoyage(voyageId)` | `voyage_omissions` + `bl_transshipments` |
| Exportação | `queryKeys.voyages.exportSchedules(voyageIds)` | `voyage_export_schedules` |
| Timeline | `['voyage-timeline', voyageId]` | `audit_logs`, resoluções e Baplie |
| Conciliação | `['baplie-reconciliation', voyageId]` | comparação física Baplie × B/L; nomes legados ainda dizem manifesto |

`src/services/queryKeys.ts` define as cinco famílias `queryKeys.voyages.*`. Nos hooks de timeline e conciliação, o `voyageId` não nulo é convertido para `String(voyageId)`; a tabela acima expressa a família lógica exigida pelos consumidores.

O payload de `useVoyages` inclui:

- `voyages`, `vessels`, `carriers` e `ports`;
- `import_batches`, inclusive `ce_master`;
- `bls`, `bl_containers` e `bl_breakbulk_items`;
- `granite_manifests`/`granite_bls`;
- `vazios_manifests`/`vazios_bookings`.

POL/POD e exportação têm contratos diferentes:

- `saveVoyagePolSchedule`, `saveVoyagePodSchedule` e `deleteVoyagePodSchedule` gravam eventos insert-only em `audit_logs`. `listVoyagePolSchedules` e `listVoyagePodSchedules*` reduzem do mais recente para o mais antigo por `entity_id` e campo.
- O trigger `trg_voyage_schedule_snapshot` mantém `voyages.pol_schedule_snapshot` e `voyages.pod_schedule_snapshot`, mas os leitores atuais de `src/services/voyageRouteSchedules.ts` ainda consultam `audit_logs`.
- `voyage_export_schedules` é uma tabela física 1:1 por `voyage_id`, com CRUD direto em `src/services/voyageExportSchedules.ts`.

## Fluxos e invariantes

1. **Seleção e deep-link.** A viagem selecionada pertence à URL; as quatro abas internas pertencem apenas ao estado de `VoyageCard`.
2. **Próxima escala.** `getProximaEscala` escolhe o menor ETA entre PODs sem ATA e sem `omitted=true`. ETA vencido continua sendo a próxima escala e deve indicar “ETA vencido — ATA pendente”; o rail usa esse valor para ordenação e filtros de período.
3. **POD removido.** “Excluir” não apaga histórico: grava `deleted=true`. Reincluir o mesmo POD por `saveVoyagePodSchedule` grava `deleted=false`.
4. **Ciclo de status.** Ao alterar ATD, `syncVoyageStatusAfterAtdChange` marca `completed` apenas quando todos os PODs ativos e nao omitidos têm ATD; caso contrário, volta a `active`. Uma viagem `cancelled` é estado retido e o guard impede que uma alteração de ATD a reverta automaticamente. Exclusão de viagem continua sendo hard delete controlado, não um status.
5. **Número de Escala ≠ VINCULADA.** `escala_number` identifica a escala criada no Mercante; `linked=true` confirma que manifestos foram vinculados à escala.
6. **CE Master ≠ CE Mercante.** CE Master é um agrupador por rota: com batch de manifesto vive em `import_batches.ce_master`; em viagem só-B/L (sem batch) vive em `voyage_route_ce_master` por `(voyage_id, pol, pod)` (#322). CE Mercante vive em cada B/L. Nenhum dos dois entra no EDI Mercante — só registro/agrupamento.
7. **Escalas & Manifestos é B/L-first.** A tabela agrupa primeiro os B/Ls por rota POL/POD. Batches e nomes de arquivo são metadados opcionais; B/Ls importados sem batch continuam aparecendo como rota, com edição de ETD e de CE Master por rota.
8. **Status de B/Ls e CEs do POD.** O valor manual salvo em `audit_logs.field_name='ces'` é soberano. Sem valor manual, a tela deriva apenas um fallback operacional: nenhum CE preenchido vira `Aguardando`, alguns CEs viram `Lançando`, todos os CEs viram `Em aprovação`; `Aprovado` só aparece quando selecionado manualmente.
9. **Timeline não financeira.** A timeline combina agenda, viagem, CE, imports e Baplie; `src/services/voyageTimeline.ts` exclui eventos financeiros por decisão de produto. Conforme decisão de domínio ainda pendente de implementação, importações de B/L devem aparecer consolidadas por rota (`quantidade · POL → POD`) e omissões devem informar POD omitido, `Porto de Transbordo — <porto>` e motivo opcional; renomeações editoriais não geram eventos.
10. **Conciliação é sinal operacional.** `divergente` tem prioridade; `incompleto` cobre falta de manifesto ou CE; `conciliado` indica coerência dos sinais usados pela tela, não autorização financeira.
11. **Importação rápida respeita a viagem aberta.** Todo importador iniciado na aba Importação recebe a viagem selecionada como escopo. No CE Mercante, B/Ls de outra viagem são divergências bloqueantes exibidas no preview e não podem ser atualizados por essa operação.
12. **Agenda preserva previsão e realidade.** Cada escala do Planejamento por POD/POL comporta ETA/ATA, ETB/ATB e ETD/ATD. ATB registra a atracação efetiva e ATD a saída efetiva; nenhum valor real sobrescreve conceitualmente seu campo estimado correspondente.
13. **Estado da escala é derivado.** ATB preenchido sem ATD significa escala `Atracada`; o preenchimento de ATD a marca automaticamente como `Concluída`. No Painel e no Line-Up TV, a linha atracada usa fonte verde, exceto os campos CEs e Linked, que preservam badges e cores próprios. Uma escala concluída deixa de receber esse destaque.
14. **ETA é a coluna de chegada exibida.** Sem ATA, mostra ETA normalmente; com ATA, mostra a data real em verde na mesma coluna, ainda intitulada ETA. O indicador `Início do ciclo` do Line-Up TV segue a mesma precedência ATA sobre ETA.
15. **A fronteira do ciclo acompanha a primeira escala.** No Line-Up TV, uma borda horizontal separa permanentemente a última escala da primeira na ordem, mesmo enquanto o carrossel se desloca. No mobile, aparece antes do card inicial; não é uma borda fixa no topo da viewport.
16. **`billingStatus` é um proxy.** Apesar do nome `fetchVoyagesWithUnpaidBls`, a consulta atual identifica viagens com B/L cujo `charge_status != 'exempt'`; não comprova pagamento de invoice.
17. **Omissao e distinta de exclusao.** `deleted=true` remove um POD do planejamento; `omitted=true` preserva a escala como evento operacional rastreavel, exclui a escala das derivacoes internas e do Portal, e abre disposicao por B/L (`transshipment` padrao ou `cod` excecao).

## Testes e validação

Evidência estática localizada:

- `src/lib/__tests__/viagensFilters.test.ts`: busca, status, conciliação, período e ordenação por próxima escala.
- `src/pages/__tests__/viagensHelpers.test.ts`: métricas, estado de conciliação, próxima escala, timeline e agrupamentos por POD/POL.
- `src/components/voyages/__tests__/voyageCardHelpers.test.tsx`: linhas de Escalas & Manifestos derivadas por rota de B/L, inclusive sem batch.
- `src/services/__tests__/voyageRouteSchedules.test.ts`: fallback automático do status de B/Ls e CEs por POD, preservando `Aprovado` como estado manual, e guard que impede ATD de reverter viagem cancelada.
- `src/pages/__tests__/Painel.behavior.test.tsx` e `src/pages/__tests__/Viagens.behavior.test.tsx`: filtros `cancelled` no Line-Up e no rail de viagens.
- `src/components/shared/__tests__/VoyageScheduleModals.test.tsx`: normalização e payload dos modais POL, POD, inclusão de POD e export schedule.
- `src/components/shared/__tests__/VoyageSectionCards.test.tsx`: navegação, estado desabilitado e componentes de métricas.
- `src/components/shared/__tests__/VoyageCombobox.test.tsx`: filtro local, seleção obrigatória/limpável e hidratação por `selectedVoyageId`.
- `src/components/shared/__tests__/VoyageImportActions.test.ts`: somente o resumo consolidado de manifestos CNTR; não prova persistência nem invalidações.

Os testes Vitest não foram executados nesta frente, conforme orientação do coordenador. Também não houve validação em navegador, Supabase ou runtime; comportamento operacional acima é classificado como inferência estática de código/migration.

## Notas e divergências

- `CONTEXT.md` é a fonte canônica de linguagem de domínio do sistema, complementada por `docs/ARCHITECTURE.md`, ADRs, código e migrations.
- As migrations 046/052 introduzem snapshots JSONB de schedule, mas a leitura atual continua baseada em `audit_logs`. Não documentar snapshot como fonte de leitura até o serviço mudar.
- O card “Vazios” navega para `/vazios?voyage=<id>`; `src/App.tsx` redireciona para `/embarquevazios` com destino fixo, portanto a preservação do query param não está garantida pelo código do redirect.
- O card de Carga Solta envia `?voyage=<id>`, mas `src/pages/CargaSolta.tsx` não inicializa seus filtros por `useSearchParams`; o contexto não é aplicado hoje.
- O CE Master é editado na ficha de Viagens por `PolScheduleModal`. `src/pages/Manifestos.tsx` não oferece edição inline atual, apesar de planos/documentação históricos associarem a ação também a Manifestos.
- A família de timeline é invalidada por prefixo `['voyage-timeline']`; o hook armazena o ID como string. A notação `['voyage-timeline', voyageId]` neste documento representa a família, não afirma tipo numérico no cache.
