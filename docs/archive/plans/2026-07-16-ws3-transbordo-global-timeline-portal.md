# WS3 — Registro global de transbordo, timeline consolidada e Portal (spec §5, §6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover navio/armador/viagem/ETD/ETA de transbordo do grão B/L (`bl_transshipments`) para um registro global por omissão (`voyage_omissions`), complementável progressivamente; timeline da Viagem com importações de B/L consolidadas por rota e eventos de omissão formatados; Portal com card persistente `Informações de Transbordo` atualizado sem nova notificação por edição; COD permanece individual por B/L.

**Architecture:** Os dados globais migram para colunas em `voyage_omissions` via migration nova + RPC `update_voyage_omission` (SECURITY DEFINER, padrão das migrations `174`/`175`). `bl_transshipments` conserva apenas `disposition` (transbordo herdado / COD). O frontend (`TransshipmentPanel`, novo card `TransshipmentInfoCard`) lê o registro global; a ficha do B/L exibe herança somente leitura. A timeline (`src/services/voyageTimeline.ts`) ganha consolidação por rota. As notificações do Portal (`portal_notifications.type='transshipment'`) já são criadas pelas RPCs — a regra nova é NÃO criar notificação em `update_voyage_omission`.

**Tech Stack:** React + TypeScript, Vitest, Supabase (migrations SQL, RPCs SECURITY DEFINER, testes de contrato SQL no padrão `voyageOmissionsMigration.test.ts`).

**Fontes obrigatórias:** spec §5–§6; `docs/adr/0022`; `supabase/migrations/174_*.sql` e `175_*.sql`; `src/services/transshipments.ts`; skill `supabase-migration`.

**Dependências:** Independente de WS1/WS2. Toca `voyage_omissions`/`bl_transshipments` — nenhum outro workstream toca essas tabelas.

---

### Task 1: Migration — registro global de transbordo em `voyage_omissions`

**Files:**
- Create: `supabase/migrations/<próximo-número>_voyage_omission_global_transshipment.sql`
- Test: `src/services/__tests__/voyageOmissionGlobalMigration.test.ts` (padrão de `voyageOmissionsMigration.test.ts`)

- [ ] **Step 1:** Leia `174_*.sql` inteiro e a skill `supabase-migration`. Escreva a migration:

```sql
-- Spec §6 / ADR 0022: dados de transbordo são um registro global da omissão,
-- compartilhado pelos B/Ls afetados e complementado progressivamente.
ALTER TABLE public.voyage_omissions
  ADD COLUMN IF NOT EXISTS onward_vessel_name TEXT,
  ADD COLUMN IF NOT EXISTS onward_carrier TEXT,
  ADD COLUMN IF NOT EXISTS onward_voyage_number TEXT,
  ADD COLUMN IF NOT EXISTS onward_etd TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onward_eta TIMESTAMPTZ;

-- Backfill: promove ao registro global o primeiro valor não nulo por omissão
-- já existente em bl_transshipments (dados legados por B/L).
UPDATE public.voyage_omissions vo SET
  onward_vessel_name = src.onward_vessel_name,
  onward_carrier = src.onward_carrier,
  onward_voyage_number = src.onward_voyage_number,
  onward_etd = src.onward_etd,
  onward_eta = src.onward_eta
FROM (
  SELECT DISTINCT ON (omission_id) omission_id,
    onward_vessel_name, onward_carrier, onward_voyage_number, onward_etd, onward_eta
  FROM public.bl_transshipments
  WHERE onward_vessel_name IS NOT NULL OR onward_carrier IS NOT NULL
     OR onward_voyage_number IS NOT NULL OR onward_etd IS NOT NULL OR onward_eta IS NOT NULL
  ORDER BY omission_id, id
) src
WHERE src.omission_id = vo.id;

-- RPC de complementação progressiva. Audita e NÃO cria portal_notifications
-- (complementos atualizam o card sem nova notificação — spec §6).
CREATE OR REPLACE FUNCTION public.update_voyage_omission(
  p_omission_id BIGINT,
  p_onward_vessel_name TEXT,
  p_onward_carrier TEXT,
  p_onward_voyage_number TEXT,
  p_onward_etd TIMESTAMPTZ,
  p_onward_eta TIMESTAMPTZ,
  p_reason TEXT,
  p_changed_by UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- copie de omit_voyage_escala (174) o guard de usuário ativo e changed_by=auth.uid()
  PERFORM public.assert_active_admin(p_changed_by); -- use o guard real da 174; se for inline, replique-o
  UPDATE public.voyage_omissions SET
    onward_vessel_name = NULLIF(btrim(COALESCE(p_onward_vessel_name, '')), ''),
    onward_carrier = NULLIF(btrim(COALESCE(p_onward_carrier, '')), ''),
    onward_voyage_number = NULLIF(btrim(COALESCE(p_onward_voyage_number, '')), ''),
    onward_etd = p_onward_etd,
    onward_eta = p_onward_eta,
    reason = NULLIF(btrim(COALESCE(p_reason, '')), '')
  WHERE id = p_omission_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'omissao % nao encontrada', p_omission_id; END IF;
  -- audit no histórico da viagem e de cada B/L afetado (spec §6):
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, new_value, changed_by, note)
  SELECT 'bl', bt.bl_id, 'transshipment_info',
         'atualizacao do registro global de transbordo', p_changed_by,
         'Informacoes de Transbordo complementadas'
  FROM public.bl_transshipments bt WHERE bt.omission_id = p_omission_id;
  -- + um audit row para a viagem (field_name='transshipment_info'), padrão da 174.
END $$;

REVOKE ALL ON FUNCTION public.update_voyage_omission(BIGINT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_voyage_omission(BIGINT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,UUID) TO authenticated;
```

**Importante:** as colunas do `audit_logs` acima são ilustrativas — copie os nomes de coluna exatos usados pelos INSERTs da migration 174. Ajuste `assert_active_admin` para o guard que a 174 realmente usa (pode ser verificação inline em `user_profiles`).

- [ ] **Step 2:** Teste de contrato SQL no padrão de `voyageOmissionsMigration.test.ts`: colunas existem; RPC atualiza campos e audita; RPC não insere `portal_notifications`; `anon` sem EXECUTE.
- [ ] **Step 3:** Run: `npm test -- src/services/__tests__/voyageOmissionGlobalMigration.test.ts` — Expected: PASS.
- [ ] **Step 4:** Commit: `git commit -m "feat: registro global de transbordo em voyage_omissions + RPC update_voyage_omission"`

### Task 2: Modal de omissão captura o registro global inicial

**Files:**
- Modify: `supabase/migrations/<próximo-número>` (mesma migration da Task 1 ou seguinte): `omit_voyage_escala` ganha parâmetros opcionais `p_onward_vessel_name/p_onward_carrier/p_onward_voyage_number/p_onward_etd/p_onward_eta` (DEFAULT NULL) gravados em `voyage_omissions` — a notificação única de omissão existente permanece
- Modify: `src/services/transshipments.ts` — `omitVoyageEscala` passa os novos campos; `VoyageOmission` ganha `onwardVesselName/onwardCarrier/onwardVoyageNumber/onwardEtd/onwardEta`; `listVoyageOmissions` os seleciona; novo `updateVoyageOmission(input)` chama a RPC da Task 1
- Modify: `src/components/voyages/OmitEscalaModal.tsx` — campos: Porto de Transbordo (obrigatório — já é `dischargePod`), Navio, Armador, Viagem, ETD, ETA, Motivo (opcionais)
- Test: `src/services/__tests__/transshipments.test.ts` (crie se não existir, mockando `supabase.rpc`)

- [ ] **Step 1: Write the failing test** — `omitVoyageEscala` envia `p_onward_*` quando informados; `updateVoyageOmission` chama `update_voyage_omission` com os parâmetros nomeados corretos.
- [ ] **Step 2:** Run: `npm test -- src/services/__tests__/transshipments.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implemente service + modal. No modal, os opcionais ficam sob um grupo "Dados de transbordo (complete quando conhecidos)". Terminologia: use `Porto de Transbordo` no label (CONTEXT.md).
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat: omissão captura registro global inicial de transbordo"`

### Task 3: Card `Informações de Transbordo` na Viagem + herança somente leitura no B/L

**Files:**
- Create: `src/components/voyages/TransshipmentInfoCard.tsx`
- Modify: `src/components/voyages/TransshipmentPanel.tsx` — remove os inputs por B/L de navio/armador/viagem/ETD/ETA (`setBlTransshipment` some do fluxo normal); mantém apenas exibição herdada + ação COD (`setCod`)
- Modify: `src/services/transshipments.ts` — `setBlTransshipment` passa a existir só como "restaurar disposição transbordo após COD" (sem campos onward); alinhe com a RPC `set_bl_transshipment` (migration da Task 1 pode limpar os parâmetros onward dela, mantendo compatibilidade: parâmetros DEFAULT NULL ignorados)
- Modify: `src/hooks/useTransshipments.ts` — mutation `updateOmission` com invalidations (`transshipments.byVoyage`, `['voyage-timeline']`, B/Ls afetados)
- Test: `src/components/voyages/__tests__/TransshipmentInfoCard.test.tsx`

- [ ] **Step 1: Write the failing test** — card renderiza os campos globais vigentes; campos vazios mostram `—` (dado ainda desconhecido, não descartável); botão `Complementar` abre edição e submete via `updateOmission`.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3:** Implemente o card na aba Visão da Viagem (junto ao `TransshipmentPanel` atual em `VoyageVisaoTab`). Na ficha do B/L, os dados globais aparecem somente leitura com a ação individual de COD preservada.
- [ ] **Step 4:** Run: `npm test -- src/components/voyages/__tests__/TransshipmentInfoCard.test.tsx` — Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat: card Informações de Transbordo global com COD individual por B/L"`

### Task 4: Timeline — importações de B/L consolidadas por rota e evento de omissão

**Files:**
- Modify: `src/services/voyageTimeline.ts` (`buildVoyageTimeline` e agregação de eventos de import)
- Test: `src/services/__tests__/voyageTimeline.test.ts` (crie se não existir; há testes de helpers de timeline — localize com `grep -rl buildVoyageTimeline src/`)

- [ ] **Step 1: Write the failing test**

```typescript
// eventos de import de B/L com mesma rota consolidam:
// entrada única "9 B/Ls importados · TAICANG → VITÓRIA"
// omissão formata: "Escala de VITÓRIA omitida · Porto de Transbordo — SANTOS · motivo: congestionamento portuário"
// omissão sem motivo: o sufixo "· motivo: ..." não aparece
// atualização do registro global gera evento "Informações de Transbordo complementadas"
```

Escreva os asserts contra a saída humanizada de `buildVoyageTimeline` com fixtures de audit rows no padrão dos testes existentes.

- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3:** Implemente a consolidação: agrupe eventos de import de B/L por (lote de importação, POL, POD) somando a contagem; formate `"{n} B/L{s} importado{s} · {POL} → {POD}"`. Para omissões, leia `omitted_pod`, `discharge_pod` e `reason` e formate conforme o teste. Renomeações editoriais não geram eventos (não crie evento para mudanças de terminologia — apenas garanta que nenhum código novo insira audit rows para isso).
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat: timeline consolida imports de B/L por rota e formata omissões (spec §5)"`

### Task 5: Portal — card persistente e disciplina de notificações

**Files:**
- Modify: RPC de overview do Portal que alimenta a ficha do B/L do cliente (localize com `grep -rn "portal_notifications" supabase/migrations/175*.sql src/services/portalOperation.ts src/services/portalBilling.ts`) — o card `Informações de Transbordo` do Portal lê os campos globais de `voyage_omissions` via a RPC de leitura já usada pela tela do Portal que mostra transbordo (migration 175 define o contrato atual; estenda a RPC de leitura com os novos campos por nova migration, número seguinte)
- Test: teste de contrato SQL no padrão dos `portal*Migration.test.ts`

- [ ] **Step 1:** Confirme na migration 175 qual RPC entrega dados de transbordo ao Portal e estenda-a (nova migration) para expor `onward_*` do registro global.
- [ ] **Step 2:** Teste de contrato: RPC retorna os campos globais; `update_voyage_omission` não cria notificação; `omit_voyage_escala` cria uma notificação por omissão; `set_bl_cod` cria notificação individual (comportamentos das RPCs existentes — assert de regressão).
- [ ] **Step 3:** Frontend do Portal: no componente que hoje mostra transbordo ao cliente (localize com `grep -rn "transshipment" src/pages/Portal*.tsx src/components/portal/`), renderize o card com os dados globais vigentes.
- [ ] **Step 4:** Run: `npm test` (arquivos tocados) — Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat: Portal exibe card persistente de Informações de Transbordo"`

### Task 6: Documentação e verificação final

**Files:**
- Modify: `docs/modules/viagens.md` (linha "Omitir escala" da tabela de ações — desenho aprovado vira estado atual), `docs/modules/portal-cliente.md`, `docs/RASTREABILIDADE.md`, `CONTEXT.md` (termo **Transbordo** — remover menção a estado futuro se houver), `docs/adr/0022` ganha nota editorial apontando a evolução para registro global (preserve o texto histórico)

- [ ] **Step 1:** Atualize os documentos vivos e a nota editorial na ADR 0022.
- [ ] **Step 2:** Run: `npm run docs:check && npm run lint && npm test && npm run build` — Expected: PASS.
- [ ] **Step 3:** Verifique spec §5–§6 critério a critério (registro global, herança, notificação única, card sem notificação por edição, COD individual).
- [ ] **Step 4:** Commit: `git commit -m "docs: transbordo global implementado (spec §5–§6)"`
