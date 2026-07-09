# Plano de correção — revisão do PR #351 (omissão de escala / transbordo / COD)

Origem: revisão de código do PR #351 (branch `claude/ship-omission-transshipment-flow-efaqs1`).
Escopo: apenas os ajustes derivados da revisão. Nenhum é bloqueante para merge; P1 é o que
vale corrigir antes ou logo após integrar. Financeiro segue **manual** (fora de escopo).

Contexto de fontes: `docs/superpowers/specs/2026-07-09-omissao-escala-transbordo-design.md`
e `docs/superpowers/plans/2026-07-09-omissao-escala-transbordo.md`.

Convenção: cada tarefa tem alvo → mudança → verificar. Marque simplificações intencionais com
`ponytail:` (CLAUDE.md §2). Rode a verificação estreita de cada tarefa e, ao final,
`npm run lint && npm test && npm run build` e `npm run docs:check` se tocar Markdown.

---

## P1 — Fidelidade do audit na reversão de COD

- **Alvo:** `supabase/migrations/174_voyage_omissions_transshipments.sql`, função
  `set_bl_transshipment`, bloco `IF v_was = 'cod' THEN`.
- **Problema:** ao reverter COD → transbordo, o audit de `pod` grava `old_value = NULL` em vez do
  POD atual (o `discharge_pod`), de onde a carga está sendo revertida. `set_bl_cod` já faz certo
  via `v_old_pod`.
- **Mudança:** capturar o pod atual do B/L antes do `UPDATE public.bls` (ex.: `SELECT pod INTO
  v_old_pod FROM public.bls WHERE id = p_bl_id`) e usá-lo como `old_value` no `INSERT INTO
  public.audit_logs(... 'pod' ...)`. Declarar `v_old_pod TEXT` no bloco `DECLARE`.
- **Nota de migração:** o PR ainda não está mergeado; editar a 174 no lugar é aceitável. Se a 174
  já tiver sido aplicada em algum banco (dev/preview), criar uma nova migração `176_*` que faça
  `CREATE OR REPLACE FUNCTION public.set_bl_transshipment(...)` com o corpo corrigido, em vez de
  alterar a 174 (arquivos de migração já aplicados são protegidos — CLAUDE.md).
- **Verificar:** `set_bl_transshipment.test`-equivalente não existe para SQL; ao menos confira via
  leitura que `v_old_pod` é lido antes do `UPDATE`. Opcional: estender
  `voyageOmissionsMigration.test.ts` com um match garantindo que o `INSERT` de `'pod'` na reversão
  não usa `NULL` literal como `old_value`.

## P2 — Query de transbordo eager em todo VoyageCard

- **Alvo:** `src/components/voyages/VoyageCard.tsx` (render incondicional de `<TransshipmentPanel>`)
  e `src/hooks/useTransshipments.ts` (`useVoyageTransshipments`).
- **Problema:** `TransshipmentPanel` monta em toda viagem aberta e dispara
  `useVoyageTransshipments` mesmo quando não há omissão (caso ~99%). Internamente ainda faz um
  `listBlTransshipments` por omissão (N+1).
- **Mudança (mínima):** manter o comportamento atual, mas documentar o teto com `ponytail:` no
  hook — ex.: `ponytail: 1 query de omissões + N de transbordos por viagem aberta; ok no volume
  atual (0–1 omissão/viagem). Upgrade = 1 SELECT com join/in quando virar hot.` Se quiser reduzir
  já: trocar o `Promise.all(map(listBlTransshipments))` por um único `select ... in('omission_id',
  ids)` em `bl_transshipments`.
- **Não** introduzir sinal novo de "tem omissão" no card só para gatear — não vale a complexidade
  agora; o painel já retorna `null` quando vazio.
- **Verificar:** `npm test` (nada deve quebrar); se refatorar o fetch, atualizar
  `transshipments.test.ts` para o novo formato de leitura.

## P2 — Dead-end quando o POD omitido é o único POD ativo

- **Alvo:** `src/components/voyages/VoyageVisaoTab.tsx` (botão "Omitir escala") e/ou
  `src/components/voyages/OmitEscalaModal.tsx`.
- **Problema:** `candidateDischargePods` pode vir vazio (POD omitido é o único ativo); o modal abre
  com `<select>` vazio e submit permanentemente desabilitado — beco sem saída.
- **Mudança:** esconder/desabilitar o botão de omitir quando não houver porto de descarga candidato
  (derivável no `VoyageCard`: `activePods.filter(p => p !== row.pod).length === 0`), ou exibir uma
  linha de ajuda dentro do modal quando `candidateDischargePods.length === 0`.
- **Verificar:** conferir manualmente (ou via teste de componente, se adicionar) que uma viagem de
  POD único não oferece o fluxo de omissão sem destino.

## P3 — Segurança de tipos nas chamadas Supabase novas

- **Alvo:** `src/services/transshipments.ts` (casts `as unknown as (...)` em `supabase.rpc`/`from`).
- **Problema:** as tabelas/RPCs novas não estão em `src/types/database.ts` (arquivo protegido), então
  as chamadas não têm checagem de nome de coluna/argumento em tempo de compilação.
- **Mudança:** regenerar os tipos do banco (fluxo do `WORKFLOW.md` / skill `supabase-migration`)
  para incluir `voyage_omissions`, `bl_transshipments` e as 3 RPCs, depois remover os casts. Exige
  autorização para tocar o arquivo protegido — **confirmar com o Lucca antes**. Se não for
  regenerar agora, adicionar um `ponytail:` no topo de `transshipments.ts` registrando o teto (sem
  type-safety nessas chamadas até a regeneração dos tipos).
- **Verificar:** `npm run build` (tsc) sem erros após remover os casts.

## P3 — Nits

- **Notificação dupla ao cliente:** `omit_voyage_escala` notifica todo cliente afetado com
  "seguirá em transbordo", inclusive B/Ls que o operador converterá em COD (que recebem depois um
  segundo aviso de "destino alterado"). Comportamento aceitável no escopo manual — **apenas
  registrar** essa característica no ADR 0022 / módulo Viagens, não mudar código.
- **Comentário `ponytail:` perdido na 175:** a `175_portal_ship_schedule_hide_omitted.sql` recriou
  a função sem o bloco de comentário sobre o custo de varrer `audit_logs` que existia na
  `173_portal_ship_schedule.sql`. Reintroduzir o comentário (o teto não mudou).
- **Re-omissão re-notifica:** a UI já esconde o botão quando `row.omitted`, então a RPC idempotente
  (`ON CONFLICT`) não é reacionável pelo fluxo normal; sem ação de código, apenas ciência.

---

## Ordem sugerida

1. P1 (audit `old_value`) — rápido e correto.
2. P2 (dead-end de POD único) e P2 (`ponytail:` do hook / N+1 opcional).
3. P3 (tipos — só com autorização) e os nits de documentação.

Ao concluir, atualize a documentação viva tocada (ADR 0022 / módulo Viagens para o nit da
notificação) e rode `npm run docs:check`, `npm run lint`, `npm test`, `npm run build`.
