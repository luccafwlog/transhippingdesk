# Plano de implementação — Redesenho da página Viagens (master-detail)

Base de decisão: ADR `docs/adr/0012-viagens-master-detail-rota-dedicada.md` e termos em `CONTEXT.md`.
Mockup de referência: `.mockups/viagens-final.html`.

Status: em execução — Fases 0–4 concluídas (PRs #237, #238, #239); Fase 5 em andamento.

---

## Objetivo

Transformar a página Viagens de lista-de-cards expansíveis em **master-detail com rota dedicada `/viagens/:id`**, reorganizar o detalhe em 4 abas, segmentar Importação por POD e Exportação por POL, e adicionar os dados de Mercante (Número de Escala, CE Master), o Estado de Conciliação e a linha do tempo.

Critério de sucesso global: a página atual continua funcionando durante a transição; nenhum dado existente é perdido; cada fase tem verificação própria e os testes passam antes e depois.

---

## Fase 0 — Descoberta pontual (sem código) ✅ (PR #237)

Confirmar a fonte das divergências de conciliação (Baplie ↔ Manifesto) e da cobertura de CE, que alimentam o **Estado de Conciliação**.

- [ ] Localizar onde divergências de Existência/Atributo são detectadas/persistidas (provável módulo de Revisão/Conciliação — ver ADR 0005/0006). → verify: identificar tabela/consulta que retorna divergências em aberto por viagem.
- [ ] Confirmar de onde sai "manifesto faltando" e "CE incompleto" (provável `bls.ce_mercante` + contagem de batches vs rotas). → verify: query que dá `ce_filled/ce_total` por viagem.

Saída: definição executável da função `deriveEstadoConciliacao(voyage)` → `'divergente' | 'incompleto' | 'conciliado'`.

---

## Fase 1 — Migração de dados (Supabase) ✅ (PR #237)

Seguir o playbook `supabase-migration` (RLS-first, list_tables antes, nota de rollback).

1. **CE Master por manifesto** — nova coluna.
   - `ALTER TABLE public.import_batches ADD COLUMN IF NOT EXISTS ce_master TEXT;`
   - Sem default, nullable (preenchido inline depois).
   - RLS: garantir que o update da coluna é permitido a operador (mesma policy de edição operacional já usada). Se hoje `import_batches` não tem policy de UPDATE para operador, expor via RPC `set_import_batch_ce_master(batch_id, ce_master)` SECURITY DEFINER (padrão ADR 0004).
   - verify: migration aplica e reverte limpa; coluna aparece em `list_tables`.

2. **Número de Escala** — **sem migração de schema**.
   - Reaproveita o padrão event-sourced: novo `field_name = 'escala_number'` nos eventos `voyage_pod_schedule` / `voyage_pol_schedule` em `audit_logs`. O trigger `trg_voyage_schedule_snapshot` (migration 046) já grava qualquer `field_name` no JSONB `pod_schedule_snapshot`/`pol_schedule_snapshot`.
   - verify: inserir evento `escala_number` e ver o snapshot atualizado.

> Decisão de simplicidade: não criar tabela nova para escala. O número vive no mesmo snapshot por POD/POL, como os demais campos da escala.

---

## Fase 2 — Serviços e hooks (camada de dados) ✅ (PR #237)

Seguir `react-query-pattern` (service-function + use*-hook, chaves e invalidação centralizadas).

1. `src/services/voyageRouteSchedules.ts`
   - Estender `VoyagePodSchedule`/`VoyagePolSchedule` com `escalaNumber: string | null`.
   - Incluir `escala_number` na leitura (reconstrução por `field_name`) e na escrita (`saveVoyagePodSchedule`/`saveVoyagePolSchedule`).
   - verify: teste unitário de round-trip do `escala_number`.

2. `src/services/imports` (ou onde batches são lidos/editados)
   - `setImportBatchCeMaster(batchId, ceMaster)` chamando o RPC/coluna.
   - Incluir `ce_master` no select de `useVoyages` (`src/hooks/useBls.ts` ~L327).
   - verify: editar CE Master e ver persistir + invalidar `['voyages']`.

3. `src/pages/viagensHelpers.ts`
   - `deriveEstadoConciliacao(voyage)` (Fase 0).
   - `getProximaEscala(voyage, podSchedules)` → `{ pod, eta }` da próxima escala futura sem ATA.
   - `summarizeImportByPod(voyage, vehicleStats)` → métricas por POD (containers, carga geral, veículos, carga solta, vazios) + total.
   - `summarizeExportByPol(voyage)` → granito/vazios por terminal de embarque.
   - verify: cobrir com testes em `src/pages/__tests__/viagensHelpers.test.ts` (já existe).

---

## Fase 3 — Roteamento e shell master-detail ✅ (PR #238)

1. `src/App.tsx`: adicionar `<Route path="/viagens/:id" element={withSuspense(<Viagens />)} />` mantendo `/viagens`. A própria `Viagens` lê `:id` e decide o detalhe selecionado.
2. `src/pages/Viagens.tsx`: layout em grid `rail | detalhe`.
   - **Rail** (novo componente `VoyageRail`): busca, filtros (status, Estado de Conciliação, armador/porto), ordenação por próxima escala; item com bolinha de Estado de Conciliação. Clique navega para `/viagens/:id`.
   - Sem `:id` → estado vazio "Selecione uma viagem" no painel.
   - Responsivo: < lg, rail vira lista de tela cheia; `/viagens/:id` ocupa a viewport.
   - verify: navegar, filtrar, deep-link `/viagens/:id` direto pela URL.

---

## Fase 4 — Detalhe da viagem em abas ✅ (PR #239)

Refatorar `src/components/voyages/VoyageCard.tsx` → `VoyageDetail` com cabeçalho + faixa de KPIs + abas. Reusar `MetricPanel`/`Info`/`NavigationCard` de `VoyageSectionCards.tsx`.

1. **Cabeçalho + KPIs**: B/Ls · CNTRs distintos · Próxima escala (POD+ETA) · Estado de conciliação (com o porquê: `CE x/y`, `n manifesto faltando`).
2. **Aba Visão geral**: tabela Planejamento POD/POL com **coluna "Nº Escala" ao final** (antes das ações), mantendo a coluna "Escala" SIM/NÃO (= vínculo de manifestos). Edição do Nº Escala no modal do POD/POL. + cards de atalho de módulo. + **timeline lateral recolhível**.
3. **Aba Importação**: uma seção por POD (sem quebra explícita Carga Geral/Veículos; sem rótulo "só Vitória") + bloco Total da viagem + importação rápida.
4. **Aba Exportação**: uma seção por terminal de embarque (POL/origem) + exportação rápida.
5. **Aba Escalas & Manifestos**: por manifesto — rota, ETD, B/Ls, status conciliação + nº divergências, ação resolver/abrir, chip Baplie + tipo de carga, cobertura CE Mercante (x/y), **CE Master editável**.
   - verify: cada aba renderiza com dados reais; edições persistem e invalidam cache.

---

## Fase 5 — Modais e edição inline ⏳ (em andamento)

- `VoyageScheduleModals.tsx`: adicionar campo **Nº Escala** ao modal de POD e ao de POL.
- Edição de **CE Master** inline na aba Manifestos (input + save por linha).
- Permissões: operador edita Nº Escala, CE Master, datas, ETD; admin para criar/excluir/estrutura (mantém o padrão atual).
- verify: como operador (não-admin), editar Nº Escala e CE Master funciona; excluir viagem/POD continua admin.

---

## Fase 6 — Linha do tempo

- `buildVoyageTimeline(voyage, schedulesAudit, batches)` agregando:
  - imports (`import_batches.uploaded_at`),
  - datas de escala (eventos `audit_logs` de `voyage_*_schedule`),
  - marcos de conciliação / escala Mercante (divergência detectada/resolvida, Nº Escala registrado, manifestos vinculados).
- Sem eventos financeiros.
- verify: timeline ordenada desc com os três tipos de evento.

---

## Fora de escopo (não fazer agora)

- Modal de Nova Viagem segue enxuto (Mercante preenchido inline depois).
- Financeiro no topo/timeline.
- Deep-links de Painel/Alertas/Financeiro para `/viagens/:id` (habilitado pela rota, mas implementado em tarefa própria).
- Polimento fino de mobile (desktop-first; mobile só não quebrar).

## Riscos / pontos de atenção

- **Estado de Conciliação** depende da fonte de divergências (Fase 0) — se inexistente, começar por "Incompleto/Conciliado" (CE + manifesto faltando) e adicionar "Divergente" quando a fonte estiver mapeada.
- Tabela POD/POL passa a ~10 colunas — validar legibilidade em 1440px.
- Regressão: a página atual é densa e operacional; manter testes de `viagensHelpers` verdes e adicionar testes para as novas funções derivadas.

## Ordem sugerida de PRs

1. Fase 1 (migração CE Master) + Fase 2 (serviços/hooks) — base de dados.
2. Fase 3 (rota + rail) — esqueleto navegável.
3. Fase 4 (detalhe em abas) — corpo.
4. Fases 5 e 6 (edição inline + timeline) — acabamento.
