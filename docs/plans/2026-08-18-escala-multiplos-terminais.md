# Escala com Múltiplos Terminais Implementation Plan

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: usar `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa. Passos usam checkbox (`- [ ]`) para rastreio.

**Objetivo:** permitir que uma escala tenha múltiplas frentes operacionais atribuídas a terminais portuários distintos, gerando ADRs independentes por terminal sem perder histórico, auditabilidade ou compatibilidade com as escalas existentes.

**Arquitetura:** a escala permanece identificada por `(viagem, porto)`. O modal de edição da escala será a única superfície de atribuição: ele mantém as frentes `(sentido, modalidade)`, o terminal de cada frente e as datas específicas de cada terminal. O banco persistirá a alocação em entidades próprias, derivará um ADR por `(viagem, porto, terminal)` e conservará ADRs legados sem terminal. A linha do tempo da viagem será a trilha de auditoria de todas as alterações manuais e automáticas.

**Stack:** React 19, TypeScript, TanStack Query, Supabase/Postgres/RLS/RPCs, Vitest, React Testing Library e as rotas atuais de Viagens, ADR, Line-Up, Painel e Line-Up TV.

---

## Decisões e limites do plano

- Frente de importação existe quando há dado operacional real: contêiner cheio, carga solta, vazio importado ou veículo.
- Frente de exportação existe quando a escala declara exportação de granito e/ou vazios; não depende da existência de linhas operacionais realizadas.
- As frentes canônicas são `importacao_carga_cheia`, `importacao_carga_solta`, `importacao_vazios`, `importacao_veiculos`, `exportacao_granito` e `exportacao_vazios`.
- Uma frente inteira pertence a um único terminal. Divisão documental por unidades permanece fora deste plano.
- Várias frentes no mesmo terminal compartilham um ADR. Um terminal sem frente atribuída não cria ADR.
- `TBC` é somente apresentação; não é salvo, não cria ADR e continua bloqueando o fechamento.
- Atribuições, remoções, reclassificações, alterações de expectativa, mudanças de terminal e mudanças de datas são registradas na timeline, inclusive quando a causa é uma atualização automática dos dados.
- Somente Operações/Admin podem atribuir frentes, alterar terminais e editar datas de terminal.
- Operações/Admin não podem alterar uma atribuição que afete ADR fechado. A API devolve o terminal/ADR bloqueador e o usuário deve reabri-lo explicitamente; não haverá reabertura automática.
- ATA e ATD globais continuam na escala. ATB, ATD e Restow do terminal ficam na alocação do terminal; ATD do terminal não pode anteceder ATB do mesmo terminal.
- A gravação da escala é atômica e usa controle de versão para impedir sobrescrita silenciosa por outro usuário.
- A migration não executará reset, limpeza ampla ou backfill destrutivo. ADRs atuais permanecem legíveis e preservados; registros novos usam o modelo terminalizado.
- Alertas e prazos não serão redesenhados neste plano. Depois do núcleo estar implementado e validado, #519/#524 serão revisadas contra o modelo real.

## Evidência da revisão da PR #550

A PR contém a decisão de produto, mas não implementação. Antes de iniciar código, a documentação da PR precisa corrigir quatro pontos: remover a recomendação de reset da Decisão 15; eliminar a contradição entre “uma linha por terminal” e “terminal como coluna”; mover a Decisão 5 para a ordem cronológica; e corrigir a referência do `LineUpTable.tsx` para `src/components/lineup/LineUpTable.tsx`. A regra de existência de exportação também deve refletir a declaração explícita de granito/vazios, conforme a reformulação da PR #546.

## Mapa de arquivos

Arquivos existentes que serão modificados:

- `docs/spec/2026-08-18-escala-multiplos-terminais-design.md` — registrar as decisões refinadas e retirar instruções obsoletas.
- `docs/spec/README.md` — manter o índice da spec viva.
- `supabase/migrations/306_escala_multiplos_terminais.sql` — registro de terminais por porto, frentes, alocações, ADR terminalizado, RPC transacional, RLS e auditoria.
- `src/services/escalaTerminalAllocation.ts` — tipos, leitura e mutação atômica da alocação da escala.
- `src/services/agencyDepartureReport.ts` — leitura/mutação por `reportId` e terminal, sem depender da chave antiga `(voyage, port)` para ADRs novos.
- `src/services/voyageRouteSchedules.ts` — projeção da escala com alocações e datas de terminal.
- `src/services/voyageExportSchedules.ts` — leitura/gravação da expectativa explícita de granito e vazios.
- `src/services/lineup.ts` — enriquecer linhas de importação/exportação com código de terminal e `TBC`.
- `src/types/database.ts` — refletir `depots.port_id` e os tipos das novas entidades quando o projeto não conseguir inferi-los diretamente.
- `src/pages/Viagens.tsx` — carregar o estado terminalizado e salvar o payload único do modal.
- `src/components/shared/VoyageScheduleModals.tsx` — edição de frentes, terminais e datas.
- `src/components/voyages/VoyageAgencyReportTab.tsx` — selecionar ADR por terminal e remover o input livre de terminal.
- `src/components/voyages/AgencyReportDocument.tsx` — renderizar o ADR por terminal e preparar o nome sugerido de impressão.
- `src/services/voyageTimeline.ts` e `src/services/voyageSummaries.ts` — buscar e humanizar eventos de terminal.
- `src/components/voyages/VoyageVisaoTab.tsx` — mostrar eventos na timeline da viagem.
- `src/components/lineup/LineUpTable.tsx`, `src/pages/Painel.tsx` e `src/pages/LineUpTVDisplay.tsx` — exibir terminal por sentido sem criar eixo adicional de linhas.
- `src/pages/DepotCadastro.tsx` — manter cadastro de terminais com porto, código e inativação.
- `CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/RASTREABILIDADE.md` e `docs/CHANGELOG.md` — atualizar somente após o comportamento estar implementado e validado.

Testes novos ou alterados:

- `src/services/__tests__/escalaTerminalAllocation.test.ts`
- `src/services/__tests__/escalaMultiTerminalMigration.test.ts`
- `src/services/__tests__/terminalPortRegistryMigration.test.ts`
- `src/services/__tests__/agencyDepartureReport.test.ts`
- `src/services/__tests__/voyageTimeline.test.ts`
- `src/services/__tests__/lineupSnapshot.test.ts`
- `src/components/shared/__tests__/VoyageScheduleModals.test.tsx`
- `src/components/voyages/__tests__/VoyageAgencyReportTab.test.tsx`
- `src/components/voyages/__tests__/VoyageVisaoTab.timeline-collapse.test.tsx`
- `src/pages/__tests__/LineUpTVDisplay.cycleStart.test.ts`
- `src/pages/__tests__/Painel.behavior.test.tsx`

Os arquivos de teste que já existirem devem ser estendidos; não criar duplicata quando o teste correspondente já cobrir o módulo.

---

### Task 1: Corrigir a spec viva e fixar o contrato de implementação

**Arquivos:**
- Modificar: `docs/spec/2026-08-18-escala-multiplos-terminais-design.md`
- Modificar: `docs/spec/README.md`
- Testar: `npm run docs:check`

- [ ] Atualizar o status da spec para deixar claro que ela descreve implementação pendente e que `CONTEXT.md` só será promovido após os gates de execução.
- [ ] Substituir o modelo “terminal livre no ADR” por “terminal registrado e atribuído por frente no modal da escala”.
- [ ] Escrever explicitamente as seis frentes, a diferença entre importação baseada em dado e exportação baseada em declaração, o bloqueio global de fechamento e o comportamento `TBC`.
- [ ] Consolidar as decisões de datas: ATA/ATD globais na escala; ATB/ATD/Restow por terminal; validação `terminal_atd >= terminal_atb`.
- [ ] Corrigir a seção de Line-Up para uma linha de importação e uma de exportação por escala, com terminal como coluna e `TBC` quando ausente.
- [ ] Remover a instrução de reset e documentar migração compatível, preservação de ADR legado e ausência de backfill destrutivo.
- [ ] Registrar que alertas/#519/#524 são dependência posterior e não parte do comportamento de alerta deste plano.
- [ ] Corrigir o caminho para `src/components/lineup/LineUpTable.tsx`, ordenar as decisões e eliminar qualquer “pendência aberta” que já tenha sido decidida nesta entrevista.
- [ ] Rodar `npm run docs:check` e confirmar que a spec aparece no índice correto.
- [ ] Commitar somente a documentação desta tarefa com `docs: define multi-terminal scale contract`.

### Task 2: Criar o modelo compatível de terminais, frentes e ADRs

**Arquivos:**
- Criar: `supabase/migrations/306_escala_multiplos_terminais.sql`
- Criar: `src/services/__tests__/escalaMultiTerminalMigration.test.ts`
- Criar: `src/services/__tests__/terminalPortRegistryMigration.test.ts`

- [ ] Adicionar `depots.port_id BIGINT REFERENCES public.ports(id) ON DELETE RESTRICT` e uma restrição que permita `port_id` somente quando `tipo = 'terminal_portuario'`; depots comuns continuam sem porto.
- [ ] Garantir código normalizado e único para locais, impedir seleção de terminal inativo em novas atribuições e preservar terminais inativos referenciados por histórico. Exclusão física deve continuar bloqueada por referência.
- [ ] Criar `voyage_escala_terminal_state` com uma linha por `(voyage_id, port, terminal_id)`, datas `terminal_atb`, `terminal_atd`, `terminal_rtw`, `revision`, `created_at`, `updated_at` e chave única da escala/terminal.
- [ ] Criar `voyage_escala_operation_fronts` com uma linha por `(voyage_id, port, sentido, modalidade)`, `terminal_id` anulável para `TBC`, fonte (`operational_data` ou `export_declaration`), timestamps e ator da última alteração.
- [ ] Aplicar `CHECK` para os seis valores canônicos de frente e índice único da frente por escala. A coluna `terminal_id` deve referenciar apenas um depot do tipo `terminal_portuario` cujo `port_id` corresponda ao porto da escala.
- [ ] Adicionar `agency_departure_reports.terminal_id` com referência restrita a terminal portuário, remover apenas a unicidade antiga que impedia múltiplos ADRs e criar índice único parcial para `(voyage_id, port, terminal_id)` quando `terminal_id IS NOT NULL`. Manter a coluna textual e os registros antigos sem terminal para leitura histórica.
- [ ] Não apagar, recriar, resetar ou escolher terminal automaticamente para ADRs legados. As tabelas de sign-off, ocorrências, snapshots e histórico continuarão referenciando `report_id`.
- [ ] Criar RPC transacional `save_voyage_escala_terminal_state(p_voyage_id, p_port, p_expected_revision, p_fronts, p_terminals, p_export_expectation, p_justification)` que: valida papel Operações/Admin; bloqueia a escala; detecta versão obsoleta; valida porto/terminal/datas; compara frentes; recusa mudanças que atinjam ADR fechado; grava estado, frentes, exportação, ADRs e auditoria em uma transação; incrementa `revision`.
- [ ] Fazer a RPC devolver uma estrutura estável com `revision`, frentes, terminais, `report_id` por terminal e uma lista de `closed_blockers`, para que a UI não precise adivinhar a causa do bloqueio.
- [ ] Ao atribuir a primeira frente a um terminal, criar ou reutilizar o ADR aberto daquele terminal. Ao remover a última frente de um terminal, remover somente o ADR aberto sem frentes; nunca remover ADR fechado.
- [ ] Rejeitar desatribuição/reclassificação que atingiria ADR fechado com erro explícito contendo o código do terminal e o `report_id`; a operação não pode aplicar nenhuma parte da alteração.
- [ ] Registrar em `audit_logs` cada mudança com `entity_type = 'voyage_pod_schedule'`, `entity_id = '<voyage_id>::<PORT>'`, campo específico, valor antigo, valor novo, `changed_by`, papel, departamento, horário e justificativa. Os eventos devem cobrir criação/remoção de frente, atribuição/troca de terminal, datas, expectativa de exportação e bloqueios/reaberturas.
- [ ] Criar RLS de leitura para usuários internos ativos e remover escrita direta nas tabelas novas; a mutação deve ocorrer pelas RPCs com `SECURITY DEFINER`, `search_path` restrito e grants somente para `authenticated`.
- [ ] Testar por leitura textual da migration: FK de porto, filtro de terminal, unicidade terminalizada, preservação da unicidade legada, guard de ADR fechado, controle de revisão, auditoria e grants/revokes.
- [ ] Commitar migration e testes com `feat: persist multi-terminal scale allocations`.

### Task 3: Alinhar a declaração explícita de exportação

**Arquivos:**
- Modificar: migration criada na Task 2
- Modificar: `src/services/voyageExportSchedules.ts`
- Modificar: `src/components/shared/VoyageScheduleModals.tsx`
- Modificar: `src/pages/Viagens.tsx`
- Testar: `src/services/__tests__/voyageRouteSchedules.test.ts`
- Testar: `src/pages/__tests__/Viagens.behavior.test.tsx`

- [ ] Adicionar ao modelo de expectativa um indicador explícito de vazios, mantendo `tem_exportacao` como declaração independente de quantidades realizadas e preservando `has_granite`.
- [ ] Fazer o payload representar `granito`, `vazios` ou ambos; não inferir frente de exportação a partir de B/L, quantidade preenchida ou existência de operação.
- [ ] Ao ativar exportação, permitir salvar a declaração sem quantidades e criar as frentes declaradas com estado `Nada operado` até que os dados existam.
- [ ] Ao retirar uma expectativa enquanto o ADR correspondente estiver aberto, remover a frente e a atribuição dentro da mesma transação, registrar o antes/depois e atualizar a timeline. Se o ADR estiver fechado, bloquear e devolver o terminal/ADR que exige reabertura.
- [ ] Preservar os campos de exportação existentes usados pela PR #546 e garantir que a projeção por `(voyage_id, pol)` continue determinística.
- [ ] Cobrir os casos: somente granito, somente vazios, ambos, declaração sem operação, retirada com ADR aberto e retirada bloqueada por ADR fechado.
- [ ] Commitar o contrato de exportação com `feat: model explicit granite and empty export fronts`.

### Task 4: Implementar leitura e mutação no domínio de escala

**Arquivos:**
- Criar: `src/services/escalaTerminalAllocation.ts`
- Modificar: `src/services/voyageRouteSchedules.ts`
- Modificar: `src/services/agencyDepartureReport.ts`
- Modificar: `src/services/queryKeys.ts`
- Criar ou estender: `src/services/__tests__/escalaTerminalAllocation.test.ts`
- Estender: `src/services/__tests__/agencyDepartureReport.test.ts`

- [ ] Definir os tipos compartilhados `OperationFrontKind`, `OperationFront`, `TerminalScaleState`, `TerminalDateState`, `AgencyReportByTerminal` e o payload de salvamento; os nomes devem ser os mesmos usados pela UI e pela projeção do Line-Up.
- [ ] Implementar `fetchEscalaTerminalState(voyageId, port)` retornando frentes derivadas, atribuições, terminais ativos disponíveis, terminais históricos usados e `revision`.
- [ ] Implementar `saveEscalaTerminalState(payload)` chamando somente a RPC transacional, traduzindo `closed_blockers` para erro de domínio acionável e invalidando escala, timeline, ADR, Line-Up, Painel e TV.
- [ ] Projetar o conjunto de frentes: importação a partir das fontes operacionais existentes e exportação a partir da declaração explícita; a projeção deve preservar uma frente já registrada até a RPC confirmar sua remoção.
- [ ] Alterar `agencyDepartureReport.ts` para ler um ADR novo por `reportId`, terminal e escala, deixando de usar `.eq('voyage_id', ...).eq('port', ...)` como identidade única. Manter caminho de leitura para ADR legado sem terminal.
- [ ] Fazer o derivador de dados do ADR selecionar somente as seções pertencentes às frentes atribuídas ao terminal. Se a frente existir sem dados, retornar a seção com estado “Nada operado”, pendente de resolução/sign-off.
- [ ] Atualizar fechamento/reabertura/sign-off para usar `reportId` nos ADRs terminalizados e preservar as RPCs legadas para registros antigos até que sejam substituídas com segurança.
- [ ] Testar agrupamento de quatro frentes em dois ADRs, `TBC`, ausência de frente, dados de exportação sem operação, separação de seções por terminal e bloqueio por ADR fechado.
- [ ] Commitar o domínio com `feat: expose terminalized escala and ADR services`.

### Task 5: Colocar a atribuição e datas no modal da escala

**Arquivos:**
- Modificar: `src/components/shared/VoyageScheduleModals.tsx`
- Modificar: `src/pages/Viagens.tsx`
- Modificar: `src/components/voyages/VoyageVisaoTab.tsx`
- Criar ou estender: `src/components/shared/__tests__/VoyageScheduleModals.test.tsx`
- Estender: `src/pages/__tests__/Viagens.behavior.test.tsx`

- [ ] Expandir `EscalaModalData` para carregar frentes, terminal selecionado, datas por terminal, opções filtradas pelo porto e `revision`.
- [ ] Renderizar uma seção “Frentes operacionais” agrupada por importação/exportação e modalidade. Cada frente terá seletor de terminal registrado; sem seleção, mostrar `TBC` e o motivo de pendência.
- [ ] Não permitir terminal inativo em nova atribuição; mostrar terminal inativo apenas quando vier associado a histórico existente.
- [ ] Renderizar ATB, ATD e Restow por terminal, ordenar os blocos por ATB, depois terminais sem ATB e, por fim, código. Validar ATD ausente/parcial e rejeitar somente `ATD < ATB`.
- [ ] Manter ATA/ATD globais no bloco da escala, sem duplicá-los em cada terminal.
- [ ] Enviar toda a edição em um único payload com `expectedRevision`. Se a RPC devolver versão obsoleta, preservar os dados digitados, informar que a escala foi atualizada e exigir recarregamento.
- [ ] Exibir erro de ADR fechado com código do terminal e ação obrigatória “Reabrir ADR”; não reabrir automaticamente e não aplicar alterações parciais.
- [ ] Exigir justificativa em qualquer troca de terminal, remoção de frente/expectativa ou alteração de data depois da primeira atribuição; salvar justificativa no mesmo evento de auditoria.
- [ ] Atualizar o pai `Viagens.tsx` para buscar o estado ao abrir o modal, chamar `saveEscalaTerminalState` e invalidar as queries sem duplicar gravações de `voyage_pod_schedule`.
- [ ] Testar interação completa no modal: quatro frentes em dois terminais, `TBC`, terminal filtrado por porto, terminal inativo, datas inválidas, conflito de revisão e bloqueio por ADR fechado.
- [ ] Commitar a superfície de operação com `feat: edit terminal fronts in escala modal`.

### Task 6: Adaptar ADR, impressão e linha do tempo

**Arquivos:**
- Modificar: `src/components/voyages/VoyageAgencyReportTab.tsx`
- Modificar: `src/components/voyages/AgencyReportDocument.tsx`
- Modificar: `src/services/voyageTimeline.ts`
- Modificar: `src/services/voyageSummaries.ts`
- Modificar: `src/components/voyages/VoyageVisaoTab.tsx`
- Criar ou estender: `src/components/voyages/__tests__/VoyageAgencyReportTab.test.tsx`
- Estender: `src/services/__tests__/voyageTimeline.test.ts`
- Estender: `src/components/voyages/__tests__/VoyageVisaoTab.timeline-collapse.test.tsx`

- [ ] Remover o input livre de terminal do cabeçalho do ADR. O documento deve receber terminal, código, nome, porto e frentes como dados derivados da escala.
- [ ] Permitir selecionar/abrir cada ADR terminalizado sem usar `(viagem, porto)` como chave de tela; listar terminais por ATB, sem ATB e código.
- [ ] Mostrar as seções de cada ADR somente para as frentes daquele terminal; frentes sem dados devem aparecer como `Nada operado` e exigir resolução/sign-off.
- [ ] Manter fechamento independente por ADR. O fechamento de um terminal não fecha os demais nem remove pendências de outro terminal.
- [ ] Alterar a impressão para usar o código no título temporário do documento, sugerindo `ADR - GREEN PECEM V.9 - BRVIX - TVV.pdf`; deixar a escolha final do arquivo para o diálogo do navegador.
- [ ] Incluir em `fetchVoyageTimelineSources` os eventos `voyage_pod_schedule` já existentes e os novos eventos terminalizados, sem vazar UUID cru para a tela.
- [ ] Adicionar tipo de evento de timeline para atribuição, troca, remoção e alteração de datas/expectativa. Humanizar com código do terminal, frente, antes/depois, autor, departamento e justificativa.
- [ ] Invalidar `voyage-timeline` após qualquer gravação de escala e garantir que a timeline seja visível na Visão da Viagem, não apenas dentro do ADR.
- [ ] Testar timeline com alteração manual e automática, operador/departamento, justificativa presente/ausente, reabertura, bloqueio e múltiplos terminais.
- [ ] Commitar ADR, impressão e auditoria com `feat: render terminalized ADR history`.

### Task 7: Adaptar Line-Up, Painel e TV

**Arquivos:**
- Modificar: `src/services/lineup.ts`
- Modificar: `src/components/lineup/LineUpTable.tsx`
- Modificar: `src/pages/Painel.tsx`
- Modificar: `src/pages/LineUpTVDisplay.tsx`
- Estender: `src/services/__tests__/lineupSnapshot.test.ts`
- Estender: `src/pages/__tests__/Painel.behavior.test.tsx`
- Estender: `src/pages/__tests__/LineUpTVDisplay.cycleStart.test.ts`

- [ ] Enriquecer `LineUpRow` com terminal de importação/exportação e exibição `TBC` sem salvar o placeholder.
- [ ] Manter exatamente uma linha de importação e uma de exportação por escala; o terminal deve ser uma coluna/atributo da linha, não um novo eixo de agrupamento.
- [ ] Para o exemplo GREEN PECEM V.9 / BRVIX, renderizar TVV na importação e PORTMAC na exportação quando essas forem as atribuições salvas.
- [ ] Para múltiplos terminais no mesmo sentido, exibir os códigos de forma determinística na mesma coluna, ordenados pela regra de ATB/sem ATB/código; não criar linhas duplicadas.
- [ ] Usar `TBC` quando nenhum terminal estiver atribuído, inclusive na TV e no Painel, sem criar ADR.
- [ ] Cobrir escala somente importação, somente exportação, ambos, declaração sem operação, múltiplos terminais e terminal histórico inativo.
- [ ] Commitar as superfícies de acompanhamento com `feat: show scale terminals in lineup surfaces`.

### Task 8: Atualizar cadastro de terminal e documentação de domínio

**Arquivos:**
- Modificar: `src/pages/DepotCadastro.tsx`
- Modificar: `src/services/depots.ts`
- Modificar: `src/types/database.ts`
- Modificar: `CONTEXT.md`
- Modificar: `docs/ARCHITECTURE.md`
- Modificar: `docs/RASTREABILIDADE.md`
- Modificar: `docs/CHANGELOG.md`
- Estender: `src/pages/__tests__/DepotCadastro.behavior.test.tsx`
- Estender: `src/services/__tests__/depots.test.ts`

- [ ] Para `terminal_portuario`, exigir porto e gravar `ports.id`; para `depot`, manter porto vazio e o comportamento atual de cadastro.
- [ ] Mostrar código como identificador operacional principal, nome como complemento e estado ativo/inativo.
- [ ] Bloquear alteração de código quando houver referências históricas; permitir inativação; impedir exclusão física referenciada.
- [ ] Atualizar `CONTEXT.md` somente agora, depois das Tasks 2–7 verificadas, promovendo `(viagem, porto, terminal)` como identidade de ADR novo e preservando explicitamente o legado.
- [ ] Atualizar arquitetura e rastreabilidade com os caminhos reais: modal da escala, ADR, timeline, Line-Up, Painel e TV.
- [ ] Registrar no changelog a compatibilidade, os limites de divisão documental e a dependência posterior de #519/#524.
- [ ] Rodar `npm run docs:check`.
- [ ] Commitar cadastro e documentação com `docs: document terminalized scale model`.

### Task 9: Verificação integrada e handoff para alertas

**Arquivos:**
- Modificar: `docs/plans/2026-08-18-escala-multiplos-terminais.md`
- Criar: `docs/archive/reports/2026-08-18-escala-multiplos-terminais-verification.md`
- Revisar depois, fora deste plano: issue #519 e issue #524

- [ ] Executar testes focados de migration, serviços, modal, ADR, timeline, Line-Up, Painel, TV e cadastro.
- [ ] Executar `npm run docs:check`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` e `git diff --check`.
- [ ] Exercitar em banco descartável a matriz mínima: escala sem terminal; importação TVV; exportação PORTMAC sem operação; quatro frentes em dois ADRs; remoção de expectativa; troca bloqueada por ADR fechado; reabertura explícita; dois usuários com revisão obsoleta; terminal inativo histórico.
- [ ] Confirmar que não houve execução de `supabase/scripts/reset_operational_data.sql`, reset amplo ou perda de registros legados.
- [ ] Registrar no relatório de verificação o commit, migrations aplicadas, resultado de cada gate, cenários exercitados e limitações de validação remota.
- [ ] Depois de o núcleo estar comprovado, revisar #519/#524 contra as chaves reais e decidir separadamente o contrato de alertas por terminal, sem misturar essa mudança no commit do núcleo.
- [ ] Atualizar o plano com os resultados e só então movê-lo para `docs/archive/plans/`; retirar sua linha de `docs/plans/README.md` e arquivar a spec quando a execução estiver comprovada.

## Critérios de aceitação

1. Uma escala pode ter importação em TVV e exportação em PORTMAC, com dois ADRs independentes e sem duplicar linhas no Line-Up.
2. Uma frente sem terminal mostra `TBC`, não cria ADR e bloqueia o fechamento de todos os ADRs da escala.
3. Exportação declarada de granito/vazios cria a frente e o ADR mesmo com “Nada operado”.
4. Várias frentes no mesmo terminal compartilham um único ADR e o ADR mostra somente suas seções.
5. Atribuição, troca, remoção, alteração de expectativa e datas aparecem na timeline com contexto completo.
6. ADR fechado bloqueia qualquer mudança que o afete e informa exatamente qual ADR precisa ser reaberto; nenhuma reabertura automática ocorre.
7. Terminal é escolhido somente do cadastro ativo ligado ao porto da escala; terminal inativo permanece visível no histórico.
8. Concorrência e validação de datas impedem gravações parciais ou sobrescritas silenciosas.
9. ADRs legados continuam acessíveis e nenhum dado operacional é apagado por migration.
10. O comportamento de alertas permanece explicitamente fora do escopo desta entrega e fica preparado para revisão posterior de #519/#524.
